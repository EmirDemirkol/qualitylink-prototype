"""
Batches module (read side) + Client Portal.

GET /batches                         list batches (clients only see their own)
GET /batches/{batchId}               full batch record for staff
GET /batches/{batchId}/certificate   Certificate of Conformance for a released batch
"""
from common import (CLIENT, ENGINEER, ON_HOLD, QA, RELEASED, STAFF, ApiError,
                    api_handler, audit, batch_deviations, batch_readings,
                    batches, describe_limit, get_user, load_batch, path_param,
                    release_checks, require_role)

CLIENT_FIELDS = ("batchId", "part", "partNo", "po", "status", "updatedAt", "holdNotice")


def _client_view(b):
    """What Halden Pharma may see: no internal quality records."""
    view = {k: b[k] for k in CLIENT_FIELDS if k in b}
    view["certificateAvailable"] = b["status"] == RELEASED
    if b["status"] != ON_HOLD:
        view.pop("holdNotice", None)
    return view


def list_batches(user):
    items = batches().scan()["Items"]
    if user["role"] == CLIENT:
        # Clients only ever get batches made for their own organisation.
        items = [_client_view(b) for b in items if b.get("client") == user["organisation"]]
    items.sort(key=lambda b: b["batchId"], reverse=True)
    return 200, {"batches": items}


def get_batch(user, batch_id):
    require_role(user, *STAFF)
    batch = load_batch(batch_id)
    rs = sorted(batch_readings(batch_id), key=lambda r: r["recordedAt"])
    ds = sorted(batch_deviations(batch_id), key=lambda d: d["openedAt"])
    for r in rs:
        r["limit"] = describe_limit(batch["spec"]["checks"][r["inspectionType"]])
    approver = user["username"] if user["role"] == QA else None
    return 200, {
        "batch": batch,
        "readings": rs,
        "deviations": ds,
        "releaseChecks": release_checks(batch, rs, ds, approver),
    }


def get_certificate(user, batch_id):
    require_role(user, CLIENT, QA, ENGINEER)
    batch = load_batch(batch_id)
    if user["role"] == CLIENT and batch.get("client") != user["organisation"]:
        raise ApiError(404, f"Batch {batch_id} not found")  # don't reveal other clients' batches
    if batch["status"] != RELEASED:
        raise ApiError(409, "A certificate is only available after QA release")

    summary = []
    rs = batch_readings(batch_id)
    for check_id, spec in batch["spec"]["checks"].items():
        values = [r for r in rs if r["inspectionType"] == check_id]
        summary.append({
            "check": spec["label"],
            "limit": describe_limit(spec),
            "samples": len(values),
            "result": "Conforms" if values and all(r["result"] == "PASS" for r in values)
            else "Conforms (deviation accepted)" if values else "Not tested",
        })

    if user["role"] == CLIENT:
        audit(user, "Certificate downloaded", batch_id, f"{batch['certificateId']} viewed in client portal")

    return 200, {"certificate": {
        "certificateId": batch["certificateId"],
        "batchId": batch_id,
        "part": batch["part"],
        "partNo": batch["partNo"],
        "po": batch["po"],
        "client": batch["client"],
        "workOrder": batch["workOrder"],
        "spec": f"{batch['spec']['id']} rev {batch['spec']['rev']}",
        "results": summary,
        "releasedBy": batch["releasedByName"],
        "releasedAt": batch["releasedAt"],
        "signatureMeaning": batch["signatureMeaning"],
    }}


@api_handler
def handler(event, context):
    user = get_user(event)
    route = event["routeKey"]
    if route == "GET /batches":
        return list_batches(user)
    if route == "GET /batches/{batchId}":
        return get_batch(user, path_param(event, "batchId"))
    if route == "GET /batches/{batchId}/certificate":
        return get_certificate(user, path_param(event, "batchId"))
    raise ApiError(404, "Unknown route")
