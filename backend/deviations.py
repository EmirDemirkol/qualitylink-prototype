"""
Deviations module.

GET   /deviations                                   list all deviations (engineer, QA)
PATCH /batches/{batchId}/deviations/{deviationId}   investigate / close (engineer only)

Every change needs a "reason for change" which goes into the audit trail,
as required for GxP records (21 CFR Part 11).
"""
from common import (DEV_CLOSED, DEV_INVESTIGATING, DEV_OPEN, ENGINEER,
                    OUTCOME_ACCEPT, OUTCOME_REJECT, QA, REJECTED, ApiError,
                    api_handler, audit, batch_deviations, batch_readings,
                    body_of, compute_status, deviations, get_user, load_batch,
                    now_iso, path_param, require_role, set_status)

TEXT_LIMIT = 2000


def list_deviations(user):
    require_role(user, ENGINEER, QA)
    items = deviations().scan()["Items"]
    items.sort(key=lambda d: d["openedAt"], reverse=True)
    return 200, {"deviations": items}


def update_deviation(user, event):
    require_role(user, ENGINEER)
    batch_id = path_param(event, "batchId")
    dev_id = path_param(event, "deviationId")
    body = body_of(event)

    dev = deviations().get_item(Key={"batchId": batch_id, "deviationId": dev_id}).get("Item")
    if not dev:
        raise ApiError(404, f"Deviation {dev_id} not found")
    if dev["status"] == DEV_CLOSED:
        raise ApiError(409, f"{dev_id} is closed and can no longer be changed")

    reason = (body.get("reasonForChange") or "").strip()
    if not reason:
        raise ApiError(400, "A reason for change is required for every edit")

    action = body.get("action")
    updates = {
        "investigation": str(body.get("investigation", dev.get("investigation", "")))[:TEXT_LIMIT],
        "rootCause": str(body.get("rootCause", dev.get("rootCause", "")))[:TEXT_LIMIT],
        "updatedAt": now_iso(),
        "updatedBy": user["name"],
    }

    if action == "start":
        if dev["status"] != DEV_OPEN:
            raise ApiError(409, "Investigation already started")
        updates["status"] = DEV_INVESTIGATING
        summary = "Investigation started"
    elif action == "save":
        summary = "Investigation notes updated"
    elif action == "close":
        outcome = body.get("outcome")
        if outcome not in (OUTCOME_ACCEPT, OUTCOME_REJECT):
            raise ApiError(400, "Choose an outcome before closing")
        if not updates["rootCause"].strip():
            raise ApiError(400, "Record the root cause before closing")
        updates.update({"status": DEV_CLOSED, "outcome": outcome,
                        "closedAt": updates["updatedAt"], "closedBy": user["name"]})
        summary = f"Deviation closed, outcome: {'batch acceptable' if outcome == OUTCOME_ACCEPT else 'batch rejected'}"
    else:
        raise ApiError(400, "action must be start, save or close")

    deviations().update_item(
        Key={"batchId": batch_id, "deviationId": dev_id},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )
    audit(user, summary, batch_id, f"{dev_id}. Reason for change: {reason}")
    dev.update(updates)

    # Closing a deviation may clear the hold (or reject the batch).
    batch = load_batch(batch_id)
    if action == "close":
        if dev["outcome"] == OUTCOME_REJECT:
            set_status(batch, REJECTED, user, f"{dev_id} closed with batch rejected")
        else:
            new_status = compute_status(batch, batch_readings(batch_id), batch_deviations(batch_id))
            set_status(batch, new_status, user, f"Hold cleared by {dev_id}",
                       {"holdNotice": ""} if new_status != batch["status"] else None)

    return 200, {"deviation": dev, "batchStatus": batch["status"]}


@api_handler
def handler(event, context):
    user = get_user(event)
    route = event["routeKey"]
    if route == "GET /deviations":
        return list_deviations(user)
    if route == "PATCH /batches/{batchId}/deviations/{deviationId}":
        return update_deviation(user, event)
    raise ApiError(404, "Unknown route")
