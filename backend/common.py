"""
Shared helpers used by every QualityLink Lambda function.

Each Lambda in this folder is one "module" from the Part 2 architecture
(Inspection, Deviations, Batch Release, Audit Trail, ...). They all share
the same small toolkit below: reading the signed-in user from the JWT,
talking to DynamoDB, writing audit entries and working out release checks.
"""
import datetime
import decimal
import json
import logging
import os
import uuid

import boto3

log = logging.getLogger()
log.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Roles (these are the Cognito groups created in template.yaml)
# ---------------------------------------------------------------------------
OPERATOR = "operator"   # line operator at a terminal: records inspections
ENGINEER = "engineer"   # quality engineer: investigates deviations, clears holds
QA = "qa"               # QA approver: reviews and e-signs batch release
CLIENT = "client"       # Halden Pharma user: read-only client portal
STAFF = (OPERATOR, ENGINEER, QA)
ROLE_PRIORITY = (QA, ENGINEER, OPERATOR, CLIENT)

# Batch statuses
IN_PRODUCTION = "IN_PRODUCTION"
ON_HOLD = "ON_HOLD"
READY_FOR_REVIEW = "READY_FOR_REVIEW"
RELEASED = "RELEASED"
REJECTED = "REJECTED"

# Deviation statuses
DEV_OPEN = "OPEN"
DEV_INVESTIGATING = "UNDER_INVESTIGATION"
DEV_CLOSED = "CLOSED"
OPEN_DEVIATION_STATES = (DEV_OPEN, DEV_INVESTIGATING)

# Deviation outcomes (what the engineer decides when closing)
OUTCOME_ACCEPT = "ACCEPT"   # no impact on product quality, batch may continue
OUTCOME_REJECT = "REJECT"   # batch rejected, can never be released


# ---------------------------------------------------------------------------
# DynamoDB access. Tables are looked up lazily so unit tests can mock AWS.
# ---------------------------------------------------------------------------
def table(env_name):
    """Return the DynamoDB table whose name is stored in an environment variable."""
    return boto3.resource("dynamodb").Table(os.environ[env_name])


def batches():
    return table("BATCHES_TABLE")


def readings():
    return table("READINGS_TABLE")


def deviations():
    return table("DEVIATIONS_TABLE")


def audit_log():
    return table("AUDIT_TABLE")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
class ApiError(Exception):
    """Raise this to return a clean error to the browser."""

    def __init__(self, status, message, extra=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra or {}


class _Encoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal; convert them for JSON."""

    def default(self, o):
        if isinstance(o, decimal.Decimal):
            # Keep "15.0" as 15.0 (a decimal limit), but "3" as 3.
            return float(o) if o.as_tuple().exponent < 0 else int(o)
        return super().default(o)


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, cls=_Encoder),
    }


def api_handler(fn):
    """Wrap a Lambda handler so errors become proper HTTP responses."""

    def wrapper(event, context):
        try:
            status, body = fn(event, context)
            return respond(status, body)
        except ApiError as err:
            return respond(err.status, {"error": err.message, **err.extra})
        except Exception:  # never leak stack traces to the browser
            log.exception("Unhandled error")
            return respond(500, {"error": "Internal error. Check CloudWatch Logs."})

    return wrapper


def body_of(event):
    raw = event.get("body") or "{}"
    try:
        return json.loads(raw, parse_float=decimal.Decimal)
    except ValueError:
        raise ApiError(400, "Request body must be JSON")


def path_param(event, name):
    value = (event.get("pathParameters") or {}).get(name)
    if not value:
        raise ApiError(400, f"Missing path parameter: {name}")
    return value


def query_param(event, name):
    return (event.get("queryStringParameters") or {}).get(name)


# ---------------------------------------------------------------------------
# Who is calling? API Gateway has already verified the Cognito JWT, so the
# claims in the request context can be trusted.
# ---------------------------------------------------------------------------
def _parse_groups(raw):
    # HTTP APIs pass list claims as a string such as "[qa engineer]".
    if isinstance(raw, list):
        return raw
    if not raw:
        return []
    return [g for g in str(raw).strip("[]").replace(",", " ").split() if g]


def get_user(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    groups = _parse_groups(claims.get("cognito:groups"))
    role = next((r for r in ROLE_PRIORITY if r in groups), None)
    if role is None:
        raise ApiError(403, "Your account has no QualityLink role")
    username = claims.get("cognito:username") or claims.get("username")
    return {
        "username": username,
        "name": claims.get("name") or username,
        "role": role,
        "organisation": claims.get("custom:organisation"),
    }


def require_role(user, *roles):
    if user["role"] not in roles:
        raise ApiError(403, f"Role '{user['role']}' is not allowed to do this")


# ---------------------------------------------------------------------------
# Time and IDs
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def short_id():
    return uuid.uuid4().hex[:6].upper()


# ---------------------------------------------------------------------------
# Audit trail (append-only).
# The Lambda roles only have dynamodb:PutItem on the audit table, never
# UpdateItem or DeleteItem, and every write refuses to overwrite an entry.
# ---------------------------------------------------------------------------
def audit(user, action, batch_id=None, details="", at=None):
    when = at or now_iso()
    item = {
        "pk": "AUDIT",
        "sk": f"{when}#{short_id()}",
        "at": when,
        "action": action,
        "actor": user["username"],
        "actorName": user["name"],
        "actorRole": user["role"],
        "details": details,
    }
    if batch_id:
        item["batchId"] = batch_id
    audit_log().put_item(Item=item, ConditionExpression="attribute_not_exists(sk)")
    return item


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------
def load_batch(batch_id):
    item = batches().get_item(Key={"batchId": batch_id}).get("Item")
    if not item:
        raise ApiError(404, f"Batch {batch_id} not found")
    return item


def batch_readings(batch_id):
    from boto3.dynamodb.conditions import Key

    return readings().query(KeyConditionExpression=Key("batchId").eq(batch_id))["Items"]


def batch_deviations(batch_id):
    from boto3.dynamodb.conditions import Key

    return deviations().query(KeyConditionExpression=Key("batchId").eq(batch_id))["Items"]


def check_reading(spec_entry, value):
    """
    Specification Check module: compare one reading with the approved spec.
    Returns (result, cleaned_value). Visual checks are PASS/FAIL picked by the
    operator; measured checks must sit inside [min, max].
    """
    if spec_entry["kind"] == "visual":
        v = str(value).upper()
        if v not in ("PASS", "FAIL"):
            raise ApiError(400, "Visual check must be PASS or FAIL")
        return v, v
    try:
        number = decimal.Decimal(str(value))
    except (decimal.InvalidOperation, ValueError):
        raise ApiError(400, "Reading must be a number")
    if not number.is_finite():
        raise ApiError(400, "Reading must be a number")
    ok = decimal.Decimal(str(spec_entry["min"])) <= number <= decimal.Decimal(str(spec_entry["max"]))
    return ("PASS" if ok else "FAIL"), number


def describe_limit(spec_entry):
    if spec_entry["kind"] == "visual":
        return "No defects"
    return f"{spec_entry['min']} to {spec_entry['max']} {spec_entry['unit']}"


def release_checks(batch, batch_readings_list, batch_deviations_list, approver=None):
    """
    The checks the QA approver sees before signing (Part 2, Figure 3).
    Release is only possible when every check is ok.
    """
    required = list(batch["spec"]["checks"].keys())
    recorded = {r["inspectionType"] for r in batch_readings_list}
    missing = [batch["spec"]["checks"][t]["label"] for t in required if t not in recorded]

    open_devs = [d for d in batch_deviations_list if d["status"] in OPEN_DEVIATION_STATES]
    failed = [r for r in batch_readings_list if r["result"] == "FAIL"]
    closed_ok = {d.get("readingId") for d in batch_deviations_list
                 if d["status"] == DEV_CLOSED and d.get("outcome") == OUTCOME_ACCEPT}
    uncovered = [r for r in failed if r["readingId"] not in closed_ok]

    checks = [
        {
            "id": "complete",
            "label": "All required inspections recorded",
            "ok": not missing,
            "detail": "All checks in the spec have results" if not missing else "Missing: " + ", ".join(missing),
        },
        {
            "id": "deviations",
            "label": "No open holds or deviations",
            "ok": not open_devs and not uncovered,
            "detail": (f"{len(open_devs)} deviation(s) still open" if open_devs
                       else f"{len(uncovered)} failed result(s) without an accepted deviation" if uncovered
                       else f"{len(failed)} failed result(s), all closed by an accepted deviation" if failed
                       else "No failed results"),
        },
        {
            "id": "state",
            "label": "Batch not already released or rejected",
            "ok": batch["status"] not in (RELEASED, REJECTED),
            "detail": f"Current status: {batch['status']}",
        },
    ]
    if approver:
        recorders = {r["recordedBy"] for r in batch_readings_list}
        checks.append({
            "id": "independent",
            "label": "Independent reviewer",
            "ok": approver not in recorders,
            "detail": "You did not record any result for this batch" if approver not in recorders
            else "You recorded results for this batch, so you cannot release it",
        })
    return checks


def compute_status(batch, batch_readings_list, batch_deviations_list):
    """Work out the batch status from its readings and deviations."""
    if batch["status"] in (RELEASED, REJECTED):
        return batch["status"]
    if any(d["status"] in OPEN_DEVIATION_STATES for d in batch_deviations_list):
        return ON_HOLD
    required = set(batch["spec"]["checks"].keys())
    recorded = {r["inspectionType"] for r in batch_readings_list}
    return READY_FOR_REVIEW if required <= recorded else IN_PRODUCTION


def set_status(batch, new_status, user, reason, extra_updates=None):
    """Change a batch status and record it in the audit trail."""
    if batch["status"] == new_status and not extra_updates:
        return batch
    updates = {"status": new_status, "updatedAt": now_iso(), **(extra_updates or {})}
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    batches().update_item(
        Key={"batchId": batch["batchId"]},
        UpdateExpression=expr,
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )
    if batch["status"] != new_status:
        audit(user, "Batch status changed", batch["batchId"],
              f"{batch['status']} -> {new_status}. {reason}")
    batch.update(updates)
    return batch
