"""
End-to-end backend tests (run: python -m pytest tests -q).
They follow the Part 2 user flow: inspect -> fail -> hold -> deviation ->
investigate -> close -> QA e-signature -> release -> client certificate.
"""
import pytest
from moto import mock_aws

from harness import DEMO_PASSWORD, call, setup_aws


@pytest.fixture(autouse=True)
def aws():
    with mock_aws():
        setup_aws()
        yield


def test_seed_matches_mockup():
    s, body = call("GET", "/batches", "engineer.murphy")
    assert s == 200
    status = {b["batchId"]: b["status"] for b in body["batches"]}
    assert status == {"B-24098": "RELEASED", "B-24109": "READY_FOR_REVIEW", "B-24117": "ON_HOLD",
                      "B-24121": "IN_PRODUCTION", "B-24125": "IN_PRODUCTION"}


def test_client_only_sees_own_batches_and_no_internal_data():
    s, body = call("GET", "/batches", "client.larsen")
    ids = {b["batchId"] for b in body["batches"]}
    assert "B-24125" not in ids and "B-24117" in ids          # Orion's batch is hidden
    assert all("spec" not in b for b in body["batches"])         # no internal quality data
    s, _ = call("GET", "/batches/{batchId}", "client.larsen", {"batchId": "B-24117"})
    assert s == 403                                              # cannot open the quality record


def test_operator_cannot_release_or_close():
    s, _ = call("POST", "/batches/{batchId}/release", "operator.kelly", {"batchId": "B-24109"},
                {"password": DEMO_PASSWORD, "meaning": "Approved for release"})
    assert s == 403
    s, _ = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "operator.kelly",
                {"batchId": "B-24117", "deviationId": "DEV-0412"}, {"action": "start", "reasonForChange": "x"})
    assert s == 403


def test_pass_readings_make_batch_ready():
    for itype, value in (("force", 6.4), ("dimensional", 5.02)):
        s, body = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                       {"inspectionType": itype, "value": value})
        assert s == 201 and body["result"] == "PASS"
    assert body["batchStatus"] == "READY_FOR_REVIEW"


def test_failed_reading_holds_batch_and_opens_deviation():
    s, body = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                   {"inspectionType": "force", "value": 9.1})
    assert s == 201 and body["result"] == "FAIL" and body["batchStatus"] == "ON_HOLD"
    assert body["deviationId"].startswith("DEV-")
    # Line is now stopped for live readings
    s, body = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                   {"inspectionType": "force", "value": 6.0})
    assert s == 409
    # ...but a reading captured offline before the hold still syncs (no data lost)
    s, body = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                   {"inspectionType": "dimensional", "value": 5.0, "offline": True,
                    "recordedAt": "2026-11-11T10:00:00.000Z"})
    assert s == 201 and body["reading"]["recordedAt"] == "2026-11-11T10:00:00.000Z"


def test_bad_input_rejected():
    s, _ = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                {"inspectionType": "force", "value": "abc"})
    assert s == 400
    s, _ = call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
                {"inspectionType": "airflow", "value": 1})   # DC-115 has no airflow check
    assert s == 400


def test_full_release_story_with_e_signature():
    ids = {"batchId": "B-24117", "deviationId": "DEV-0412"}
    # QA cannot release while the deviation is open
    s, body = call("GET", "/batches/{batchId}", "qa.walsh", {"batchId": "B-24117"})
    assert not all(c["ok"] for c in body["releaseChecks"])

    # Engineer investigates; reason for change is mandatory
    s, _ = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "engineer.murphy", ids, {"action": "start"})
    assert s == 400
    s, _ = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "engineer.murphy", ids,
                {"action": "start", "reasonForChange": "Starting investigation"})
    assert s == 200
    s, _ = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "engineer.murphy", ids,
                {"action": "close", "outcome": "ACCEPT", "reasonForChange": "Investigation complete"})
    assert s == 400  # root cause required
    s, body = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "engineer.murphy", ids,
                   {"action": "close", "outcome": "ACCEPT", "rootCause": "Gauge G-07 out of calibration; retest 19.6 N",
                    "reasonForChange": "Investigation complete"})
    assert s == 200 and body["batchStatus"] == "READY_FOR_REVIEW"

    # Wrong password: signature refused and logged
    s, _ = call("POST", "/batches/{batchId}/release", "qa.walsh", {"batchId": "B-24117"},
                {"password": "wrong-password", "meaning": "Approved for release"})
    assert s == 401

    s, body = call("POST", "/batches/{batchId}/release", "qa.walsh", {"batchId": "B-24117"},
                   {"password": DEMO_PASSWORD, "meaning": "Approved for release"})
    assert s == 200 and body["batch"]["status"] == "RELEASED"

    # Can't release twice
    s, _ = call("POST", "/batches/{batchId}/release", "qa.walsh", {"batchId": "B-24117"},
                {"password": DEMO_PASSWORD, "meaning": "Approved for release"})
    assert s == 409

    # Client can now download the certificate
    s, body = call("GET", "/batches/{batchId}/certificate", "client.larsen", {"batchId": "B-24117"})
    assert s == 200 and body["certificate"]["certificateId"] == "CoC-B-24117"

    # Audit trail has the whole story
    s, body = call("GET", "/audit", "qa.walsh", query={"batchId": "B-24117"})
    actions = [e["action"] for e in body["entries"]]
    for expected in ("Investigation started", "E-signature failed", "Batch released (e-signature)",
                     "Certificate downloaded", "Deviation opened automatically"):
        assert expected in actions


def test_reject_outcome_blocks_release_forever():
    ids = {"batchId": "B-24117", "deviationId": "DEV-0412"}
    s, body = call("PATCH", "/batches/{batchId}/deviations/{deviationId}", "engineer.murphy", ids,
                   {"action": "close", "outcome": "REJECT", "rootCause": "Mould cavity 4 worn",
                    "reasonForChange": "Batch scrapped"})
    assert body["batchStatus"] == "REJECTED"
    s, _ = call("POST", "/batches/{batchId}/release", "qa.walsh", {"batchId": "B-24117"},
                {"password": DEMO_PASSWORD, "meaning": "Approved for release"})
    assert s == 409


def test_client_cannot_get_other_clients_or_unreleased_certificates():
    s, _ = call("GET", "/batches/{batchId}/certificate", "client.larsen", {"batchId": "B-24125"})
    assert s == 404
    s, _ = call("GET", "/batches/{batchId}/certificate", "client.larsen", {"batchId": "B-24109"})
    assert s == 409
    s, body = call("GET", "/batches/{batchId}/certificate", "client.larsen", {"batchId": "B-24098"})
    assert s == 200


def test_unknown_role_is_refused():
    s, _ = call("GET", "/batches", "client.larsen", claims={"cognito:username": "x", "cognito:groups": "[]"})
    assert s == 403


def test_metrics_dashboard():
    s, body = call("GET", "/metrics", "engineer.murphy")
    assert s == 200
    k = body["kpis"]
    assert k["batchesOnHold"] == 1 and k["openDeviations"] == 1
    assert k["firstPassYieldPct"] == 75.0            # 3 of 4 inspected batches had no failure
    assert 25 < k["avgHoursToRelease"] < 35          # B-24098: first inspection to QA sign-off
    assert body["failuresByCheck"][0]["count"] == 1
    assert body["recentFailures"][0]["deviationId"] == "DEV-0412"
    # Only staff who manage quality can see it
    assert call("GET", "/metrics", "operator.kelly")[0] == 403
    assert call("GET", "/metrics", "client.larsen")[0] == 403


def test_metrics_follow_a_new_failure():
    call("POST", "/batches/{batchId}/readings", "operator.kelly", {"batchId": "B-24121"},
         {"inspectionType": "force", "value": 9.1})
    k = call("GET", "/metrics", "qa.walsh")[1]["kpis"]
    assert k["batchesOnHold"] == 2 and k["openDeviations"] == 2
    assert k["firstPassYieldPct"] == 50.0
