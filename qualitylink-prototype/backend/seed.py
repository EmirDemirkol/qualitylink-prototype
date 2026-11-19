"""
Demo data loader (admin tool, NOT part of the QualityLink product).

Invoke it to (re)load the sample data and demo accounts:
    ./scripts/reset-demo.sh

It wipes the tables, recreates four demo users in Cognito and loads sample
batches that match the Part 2 mock-up (B-24117 on hold, B-24109 ready for
review, B-24098 released, ...). All data is fictional sample data.

This is the only function allowed to delete audit entries, and only so the
demo can be reset. In the proposed production design the audit archive sits
in S3 Object Lock where nobody can delete it.
"""
import datetime
import os
from decimal import Decimal as D

import boto3
from botocore.config import Config

import common
from common import (DEV_OPEN, IN_PRODUCTION, ON_HOLD, READY_FOR_REVIEW, RELEASED,
                    audit, batches, deviations, readings)

RETRY = Config(retries={"max_attempts": 10, "mode": "adaptive"})

USERS = [
    {"username": "operator.kelly", "name": "S. Kelly", "role": common.OPERATOR},
    {"username": "engineer.murphy", "name": "A. Murphy", "role": common.ENGINEER},
    {"username": "qa.walsh", "name": "C. Walsh", "role": common.QA},
    {"username": "client.larsen", "name": "M. Larsen", "role": common.CLIENT, "organisation": "Halden Pharma"},
]
U = {u["username"]: u for u in USERS}
SYSTEM = {"username": "system", "name": "QualityLink (automatic)", "role": "system"}

# Approved specifications (in production these sync from document control).
# Limits are stored as text so "15.0" keeps its decimal place.
SPEC_CAP220 = {"id": "QS-220", "rev": "C", "checks": {
    "visual": {"label": "Visual", "kind": "visual"},
    "airflow": {"label": "Airflow", "kind": "range", "min": "28.0", "max": "32.0", "unit": "L/min"},
    "force": {"label": "Cap-fit force", "kind": "range", "min": "15.0", "max": "22.0", "unit": "N"},
    "dimensional": {"label": "Dimensional", "kind": "range", "min": "12.30", "max": "12.50", "unit": "mm"},
}}
SPEC_MP310 = {"id": "QS-310", "rev": "B", "checks": {
    "visual": {"label": "Visual", "kind": "visual"},
    "airflow": {"label": "Airflow", "kind": "range", "min": "30.0", "max": "34.0", "unit": "L/min"},
    "force": {"label": "Insertion force", "kind": "range", "min": "10.0", "max": "16.0", "unit": "N"},
    "dimensional": {"label": "Outer diameter", "kind": "range", "min": "22.40", "max": "22.60", "unit": "mm"},
}}
SPEC_DC115 = {"id": "QS-115", "rev": "A", "checks": {
    "visual": {"label": "Visual", "kind": "visual"},
    "force": {"label": "Actuation force", "kind": "range", "min": "5.0", "max": "8.0", "unit": "N"},
    "dimensional": {"label": "Window height", "kind": "range", "min": "4.90", "max": "5.10", "unit": "mm"},
}}


def _ago(days=0, hours=0, minutes=0):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days, hours=hours, minutes=minutes)
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _wipe(tbl, keys):
    scan = tbl.scan(ProjectionExpression=", ".join(f"#{k}" for k in keys),
                    ExpressionAttributeNames={f"#{k}": k for k in keys})
    items = scan["Items"]
    while "LastEvaluatedKey" in scan:
        scan = tbl.scan(ProjectionExpression=", ".join(f"#{k}" for k in keys),
                        ExpressionAttributeNames={f"#{k}": k for k in keys},
                        ExclusiveStartKey=scan["LastEvaluatedKey"])
        items += scan["Items"]
    with tbl.batch_writer() as bw:
        for it in items:
            bw.delete_item(Key={k: it[k] for k in keys})
    return len(items)


def _users():
    idp = boto3.client("cognito-idp", config=RETRY)
    pool = os.environ["USER_POOL_ID"]
    for u in USERS:
        attrs = [{"Name": "name", "Value": u["name"]}]
        if u.get("organisation"):
            attrs.append({"Name": "custom:organisation", "Value": u["organisation"]})
        try:
            idp.admin_create_user(UserPoolId=pool, Username=u["username"],
                                  UserAttributes=attrs, MessageAction="SUPPRESS")
        except idp.exceptions.UsernameExistsException:
            idp.admin_update_user_attributes(UserPoolId=pool, Username=u["username"], UserAttributes=attrs)
        idp.admin_set_user_password(UserPoolId=pool, Username=u["username"],
                                    Password=os.environ["DEMO_PASSWORD"], Permanent=True)
        idp.admin_add_user_to_group(UserPoolId=pool, Username=u["username"], GroupName=u["role"])


def _batch(batch_id, part, part_no, wo, po, line, client, spec, status, updated, **extra):
    return {"batchId": batch_id, "part": part, "partNo": part_no, "workOrder": wo, "po": po,
            "line": line, "client": client, "spec": spec, "status": status,
            "createdAt": updated, "updatedAt": updated, **extra}


def _reading(batch_id, n, itype, value, unit, result, user, at, terminal):
    return {"batchId": batch_id, "readingId": f"R-{batch_id[-3:]}{n:02d}", "inspectionType": itype,
            "value": value, "unit": unit, "result": result, "recordedBy": user["username"],
            "recordedByName": user["name"], "recordedAt": at, "syncedAt": at,
            "terminal": terminal, "offline": False}


def _load_data():
    kelly, murphy, walsh = U["operator.kelly"], U["engineer.murphy"], U["qa.walsh"]
    bt = batches()
    rt = readings()

    # B-24098: released 12 days ago, certificate available to Halden.
    rel_at = _ago(days=12, hours=2)
    bt.put_item(Item=_batch("B-24098", "Inhaler cap", "CAP-220", "WO-88190", "HP-7764", "Line 2",
                            "Halden Pharma", SPEC_CAP220, RELEASED, rel_at,
                            releasedBy="qa.walsh", releasedByName="C. Walsh", releasedAt=rel_at,
                            signatureMeaning="Approved for release", certificateId="CoC-B-24098"))
    rows_098 = [("visual", "PASS", "", "PASS", 13, 9), ("airflow", D("29.6"), "L/min", "PASS", 13, 8),
                ("force", D("18.9"), "N", "PASS", 13, 7), ("force", D("19.4"), "N", "PASS", 13, 6),
                ("dimensional", D("12.40"), "mm", "PASS", 13, 5)]
    for i, (t, v, unit, res, d, h) in enumerate(rows_098, 1):
        at = _ago(days=d, hours=h)
        rt.put_item(Item=_reading("B-24098", i, t, v, unit, res, kelly, at, "T-03"))
        audit(kelly, "Inspection recorded", "B-24098", f"{SPEC_CAP220['checks'][t]['label']} = {v} {unit} -> {res}".replace("  ", " "), at=at)
    audit(walsh, "Batch released (e-signature)", "B-24098",
          "Signed by C. Walsh (qa.walsh), meaning: 'Approved for release'. Certificate CoC-B-24098 generated.", at=rel_at)

    # B-24109: every result passed, waiting for QA review.
    upd = _ago(hours=5)
    bt.put_item(Item=_batch("B-24109", "Mouthpiece", "MP-310", "WO-88205", "HP-7781", "Line 1",
                            "Halden Pharma", SPEC_MP310, READY_FOR_REVIEW, upd))
    rows_109 = [("visual", "PASS", "", "PASS", 9), ("airflow", D("31.8"), "L/min", "PASS", 8),
                ("force", D("12.7"), "N", "PASS", 7), ("dimensional", D("22.51"), "mm", "PASS", 6),
                ("dimensional", D("22.47"), "mm", "PASS", 5)]
    for i, (t, v, unit, res, h) in enumerate(rows_109, 1):
        at = _ago(hours=h)
        rt.put_item(Item=_reading("B-24109", i, t, v, unit, res, kelly, at, "T-01"))
        audit(kelly, "Inspection recorded", "B-24109", f"{SPEC_MP310['checks'][t]['label']} = {v} {unit} -> {res}".replace("  ", " "), at=at)
    audit(kelly, "Batch status changed", "B-24109", "IN_PRODUCTION -> READY_FOR_REVIEW. All required inspections recorded", at=upd)

    # B-24117: cap-fit force failed, batch on hold, deviation open (the Part 2 story).
    hold_at = _ago(hours=3, minutes=12)
    bt.put_item(Item=_batch("B-24117", "Inhaler cap", "CAP-220", "WO-88214", "HP-7781", "Line 2",
                            "Halden Pharma", SPEC_CAP220, ON_HOLD, hold_at,
                            holdNotice="Held by Meridian quality while a deviation is investigated. "
                                       "It will not ship until released."))
    rows_117 = [("visual", "PASS", "", "PASS", 4, 40), ("airflow", D("30.1"), "L/min", "PASS", 4, 20),
                ("dimensional", D("12.41"), "mm", "PASS", 4, 0), ("force", D("19.8"), "N", "PASS", 3, 30),
                ("force", D("23.6"), "N", "FAIL", 3, 12)]
    for i, (t, v, unit, res, h, m) in enumerate(rows_117, 1):
        at = _ago(hours=h, minutes=m)
        rt.put_item(Item=_reading("B-24117", i, t, v, unit, res, kelly, at, "T-03"))
        audit(kelly, "Inspection recorded", "B-24117", f"{SPEC_CAP220['checks'][t]['label']} = {v} {unit} -> {res}".replace("  ", " "), at=at)
    deviations().put_item(Item={
        "batchId": "B-24117", "deviationId": "DEV-0412", "readingId": "R-11705", "status": DEV_OPEN,
        "title": "Cap-fit force out of specification",
        "description": "Cap-fit force 23.6 N recorded on T-03 by S. Kelly. Limit: 15.0 to 22.0 N (QS-220 rev C).",
        "openedAt": hold_at, "openedBy": "QualityLink (automatic)", "investigation": "", "rootCause": ""})
    audit(kelly, "Deviation opened automatically", "B-24117", "DEV-0412: Cap-fit force out of specification", at=hold_at)
    audit(kelly, "Batch status changed", "B-24117", "IN_PRODUCTION -> ON_HOLD. Failed result opened DEV-0412", at=hold_at)
    audit(SYSTEM, "Alert sent", "B-24117", "Quality engineer on shift (A. Murphy) notified of hold", at=hold_at)

    # B-24121: in production, the batch to use for the live line-terminal demo.
    upd = _ago(hours=1, minutes=5)
    bt.put_item(Item=_batch("B-24121", "Dose counter", "DC-115", "WO-88230", "HP-7790", "Line 3",
                            "Halden Pharma", SPEC_DC115, IN_PRODUCTION, upd))
    rt.put_item(Item=_reading("B-24121", 1, "visual", "PASS", "", "PASS", kelly, upd, "T-03"))
    audit(kelly, "Inspection recorded", "B-24121", "Visual = PASS -> PASS", at=upd)

    # B-24125: belongs to another client, proves Halden cannot see it.
    upd = _ago(minutes=40)
    bt.put_item(Item=_batch("B-24125", "Inhaler cap", "CAP-220", "WO-88233", "OR-1120", "Line 2",
                            "Orion Respiratory", SPEC_CAP220, IN_PRODUCTION, upd))
    audit(murphy, "Batch opened", "B-24125", "Work order WO-88233 received from ERP", at=upd)
    return 5


def handler(event, context):
    counts = {
        "batches": _wipe(batches(), ["batchId"]),
        "readings": _wipe(readings(), ["batchId", "readingId"]),
        "deviations": _wipe(deviations(), ["batchId", "deviationId"]),
        "audit": _wipe(common.audit_log(), ["pk", "sk"]),
    }
    _users()
    loaded = _load_data()
    return {"status": "ok", "deleted": counts, "batchesLoaded": loaded, "users": [u["username"] for u in USERS]}
