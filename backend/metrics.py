"""
Quality KPI dashboard (read side).

GET /metrics   live quality KPIs for quality engineers and QA approvers

The KPIs map to the business goals in Part 1:
  - prevent non-conforming batches being released  -> batches on hold, open deviations
  - catch problems at the line                      -> first-pass yield, failures by check
  - batch release from days to hours                 -> average time to release (target 24 h)

Prototype note: this Lambda scans three small tables on every request, which is
fine for a few batches. In production the KPIs would be pre-aggregated
(DynamoDB Streams -> a metrics table, or an export to Athena/QuickSight) so the
dashboard never scans the live tables. Its IAM role can only read.
"""
import datetime

from common import (DEV_CLOSED, ENGINEER, OPEN_DEVIATION_STATES, QA, RELEASED,
                    api_handler, batches, deviations, get_user, readings,
                    require_role)

RELEASE_TARGET_HOURS = 24          # Part 1 goal "days to hours", made measurable
STATUS_ORDER = ["IN_PRODUCTION", "ON_HOLD", "READY_FOR_REVIEW", "RELEASED", "REJECTED"]


def _scan_all(tbl):
    """Read every item, following DynamoDB's 1 MB pages."""
    items, kwargs = [], {}
    while True:
        page = tbl.scan(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _parse(iso):
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _hours(start_iso, end_iso):
    return (_parse(end_iso) - _parse(start_iso)).total_seconds() / 3600


def _pct(part, whole):
    return round(100 * part / whole, 1) if whole else None


def build_metrics(all_batches, all_readings, all_deviations, now_iso):
    by_batch = {b["batchId"]: b for b in all_batches}

    # 1. Batches by status
    counts = {s: 0 for s in STATUS_ORDER}
    for b in all_batches:
        counts[b["status"]] = counts.get(b["status"], 0) + 1

    # 2. Open deviations and how long they have been open
    open_devs = []
    for d in all_deviations:
        if d["status"] in OPEN_DEVIATION_STATES:
            open_devs.append({"batchId": d["batchId"], "deviationId": d["deviationId"],
                              "title": d.get("title", ""), "status": d["status"],
                              "ageHours": round(_hours(d["openedAt"], now_iso), 1)})
    open_devs.sort(key=lambda d: d["ageHours"], reverse=True)
    closed = [d for d in all_deviations if d["status"] == DEV_CLOSED and d.get("closedAt")]
    avg_close = (round(sum(_hours(d["openedAt"], d["closedAt"]) for d in closed) / len(closed), 1)
                 if closed else None)

    # 3. First-pass yield: batches inspected with no failed result
    readings_by_batch = {}
    for r in all_readings:
        readings_by_batch.setdefault(r["batchId"], []).append(r)
    inspected = [bid for bid, rs in readings_by_batch.items() if rs]
    clean = [bid for bid in inspected if all(r["result"] == "PASS" for r in readings_by_batch[bid])]
    passed = sum(1 for r in all_readings if r["result"] == "PASS")

    # 4. Time to release: first inspection -> QA e-signature
    release_hours = []
    for b in all_batches:
        rs = readings_by_batch.get(b["batchId"])
        if b["status"] == RELEASED and b.get("releasedAt") and rs:
            first = min(r["recordedAt"] for r in rs)
            release_hours.append(_hours(first, b["releasedAt"]))
    avg_release = round(sum(release_hours) / len(release_hours), 1) if release_hours else None

    # 5. Failures by check type (Pareto: biggest cause first)
    fails_by_check = {}
    recent_fails = []
    for r in all_readings:
        if r["result"] != "FAIL":
            continue
        batch = by_batch.get(r["batchId"], {})
        spec_checks = batch.get("spec", {}).get("checks", {})
        label = spec_checks.get(r["inspectionType"], {}).get("label", r["inspectionType"])
        fails_by_check[label] = fails_by_check.get(label, 0) + 1
        dev = next((d["deviationId"] for d in all_deviations if d.get("readingId") == r["readingId"]), None)
        recent_fails.append({"batchId": r["batchId"], "check": label, "value": r["value"],
                             "unit": r.get("unit", ""), "recordedAt": r["recordedAt"],
                             "recordedByName": r.get("recordedByName", ""), "deviationId": dev})
    recent_fails.sort(key=lambda f: f["recordedAt"], reverse=True)

    return {
        "generatedAt": now_iso,
        "kpis": {
            "batchesOnHold": counts.get("ON_HOLD", 0),
            "openDeviations": len(open_devs),
            "oldestOpenDeviationHours": open_devs[0]["ageHours"] if open_devs else None,
            "firstPassYieldPct": _pct(len(clean), len(inspected)),
            "batchesInspected": len(inspected),
            "readingPassRatePct": _pct(passed, len(all_readings)),
            "readingsTotal": len(all_readings),
            "avgHoursToRelease": avg_release,
            "releasedBatches": len(release_hours),
            "releaseTargetHours": RELEASE_TARGET_HOURS,
            "avgHoursToCloseDeviation": avg_close,
        },
        "statusCounts": [{"status": s, "count": counts[s]} for s in counts],
        "failuresByCheck": sorted(({"check": k, "count": v} for k, v in fails_by_check.items()),
                                  key=lambda x: x["count"], reverse=True),
        "openDeviations": open_devs,
        "recentFailures": recent_fails[:5],
    }


@api_handler
def handler(event, context):
    user = get_user(event)
    require_role(user, ENGINEER, QA)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return 200, build_metrics(_scan_all(batches()), _scan_all(readings()),
                              _scan_all(deviations()), now_iso)
