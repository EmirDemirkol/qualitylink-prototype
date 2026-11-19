"""
Inspection module (+ Specification Check and Hold, which Part 2 lists as
separate modules; in the prototype they run in one Lambda).

POST /batches/{batchId}/readings
  1. Only an operator may record a result.
  2. The reading is checked against the approved spec stored on the batch.
  3. A failed result places the batch ON HOLD and opens a deviation
     automatically, so a bad batch can never quietly carry on.
  4. Everything is written to the audit trail.

Readings captured while the line gateway was offline arrive later with
"offline": true and their original recordedAt time (store-and-forward).
"""
from common import (DEV_OPEN, IN_PRODUCTION, ON_HOLD, OPERATOR, READY_FOR_REVIEW,
                    ApiError, api_handler, audit, batch_deviations, batch_readings,
                    check_reading, compute_status, deviations, get_user, load_batch,
                    now_iso, path_param, readings, require_role, set_status, short_id,
                    body_of)


@api_handler
def handler(event, context):
    user = get_user(event)
    require_role(user, OPERATOR)
    batch_id = path_param(event, "batchId")
    body = body_of(event)
    batch = load_batch(batch_id)

    inspection_type = body.get("inspectionType")
    spec_entry = batch["spec"]["checks"].get(inspection_type)
    if not spec_entry:
        raise ApiError(400, f"Unknown inspection type: {inspection_type}")

    offline = bool(body.get("offline"))
    # Live readings are only accepted while the batch is running. Readings that
    # were captured offline before a hold are still accepted so no data is lost.
    allowed = (IN_PRODUCTION, READY_FOR_REVIEW) + ((ON_HOLD,) if offline else ())
    if batch["status"] not in allowed:
        raise ApiError(409, f"Batch {batch_id} is {batch['status'].replace('_', ' ').lower()}; "
                            "no new results can be recorded")

    result, value = check_reading(spec_entry, body.get("value"))
    synced_at = now_iso()
    recorded_at = str(body.get("recordedAt"))[:30] if offline and body.get("recordedAt") else synced_at
    reading = {
        "batchId": batch_id,
        "readingId": f"R-{short_id()}",
        "inspectionType": inspection_type,
        "value": value,
        "unit": spec_entry.get("unit", ""),
        "result": result,
        "recordedBy": user["username"],
        "recordedByName": user["name"],
        "recordedAt": recorded_at,
        "syncedAt": synced_at,
        "terminal": str(body.get("terminal") or "T-03")[:20],
        "offline": offline,
    }
    readings().put_item(Item=reading)
    shown_value = f"{value} {spec_entry.get('unit', '')}".strip()
    audit(user, "Inspection recorded", batch_id,
          f"{spec_entry['label']} = {shown_value} -> {result}"
          + (" (captured offline, synced by gateway)" if offline else ""))

    response = {"reading": reading, "result": result}

    if result == "FAIL":
        deviation = {
            "batchId": batch_id,
            "deviationId": f"DEV-{short_id()[:4]}",
            "readingId": reading["readingId"],
            "status": DEV_OPEN,
            "title": f"{spec_entry['label']} out of specification",
            "description": (f"{spec_entry['label']} {shown_value} recorded on {reading['terminal']} "
                            f"by {user['name']}. Limit: {spec_entry.get('min', '')} to "
                            f"{spec_entry.get('max', '')} {spec_entry.get('unit', '')} "
                            f"({batch['spec']['id']} rev {batch['spec']['rev']})."
                            if spec_entry["kind"] != "visual" else
                            f"Visual defect reported on {reading['terminal']} by {user['name']}."),
            "openedAt": synced_at,
            "openedBy": "QualityLink (automatic)",
            "investigation": "",
            "rootCause": "",
        }
        deviations().put_item(Item=deviation)
        audit(user, "Deviation opened automatically", batch_id,
              f"{deviation['deviationId']}: {deviation['title']}")
        set_status(batch, ON_HOLD, user, f"Failed result opened {deviation['deviationId']}",
                   {"holdNotice": "Held by Meridian quality while a deviation is investigated. "
                                  "It will not ship until released."})
        response["deviationId"] = deviation["deviationId"]
    else:
        new_status = compute_status(batch, batch_readings(batch_id), batch_deviations(batch_id))
        set_status(batch, new_status, user, "All required inspections recorded"
                   if new_status == READY_FOR_REVIEW else "Inspection recorded")

    response["batchStatus"] = batch["status"]
    return 201, response
