"""
Batch Release and E-signature module. This is the ONLY code path that can
release a batch (Part 2 design rule).

POST /batches/{batchId}/release   body: {"password": "...", "meaning": "Approved for release"}

Electronic signature (21 CFR Part 11 style):
  * The approver re-enters their password at the moment of signing. We check
    it against Cognito again, so a session left open on a desk is not enough.
  * The signature records who signed, when, and what the signature means.
  * Every release check must pass first, including "independent reviewer".
"""
import os

import boto3
from botocore.exceptions import ClientError

from common import (QA, READY_FOR_REVIEW, RELEASED, ApiError, api_handler, audit,
                    batch_deviations, batch_readings, batches, body_of, get_user,
                    load_batch, now_iso, path_param, release_checks, require_role)

SIGNATURE_MEANINGS = ("Approved for release",)


def verify_password(username, password):
    """Ask Cognito to authenticate the user again. Returns True if the password is right."""
    try:
        boto3.client("cognito-idp").initiate_auth(
            ClientId=os.environ["USER_POOL_CLIENT_ID"],
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": password},
        )
        return True
    except ClientError as err:
        if err.response["Error"]["Code"] in ("NotAuthorizedException", "UserNotFoundException"):
            return False
        raise


@api_handler
def handler(event, context):
    user = get_user(event)
    require_role(user, QA)
    batch_id = path_param(event, "batchId")
    body = body_of(event)

    meaning = body.get("meaning")
    if meaning not in SIGNATURE_MEANINGS:
        raise ApiError(400, "Choose the meaning of your signature")
    password = body.get("password") or ""
    if not password:
        raise ApiError(400, "Re-enter your password to sign")

    if not verify_password(user["username"], password):
        audit(user, "E-signature failed", batch_id, "Wrong password entered at signing")
        raise ApiError(401, "Password not recognised. Signature not applied.")

    batch = load_batch(batch_id)
    checks = release_checks(batch, batch_readings(batch_id), batch_deviations(batch_id), user["username"])
    failing = [c for c in checks if not c["ok"]]
    if failing:
        audit(user, "Release blocked", batch_id, "; ".join(c["label"] for c in failing))
        raise ApiError(409, "Release checks not met", {"releaseChecks": checks})

    signed_at = now_iso()
    certificate_id = f"CoC-{batch_id}"
    try:
        # The condition stops a double release if two approvers click at once.
        batches().update_item(
            Key={"batchId": batch_id},
            UpdateExpression=("SET #s = :released, updatedAt = :t, releasedBy = :u, releasedByName = :n, "
                              "releasedAt = :t, signatureMeaning = :m, certificateId = :c"),
            ConditionExpression="#s = :ready",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":released": RELEASED, ":ready": READY_FOR_REVIEW, ":t": signed_at,
                                       ":u": user["username"], ":n": user["name"], ":m": meaning,
                                       ":c": certificate_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ApiError(409, "Batch is no longer ready for review")
        raise

    audit(user, "Batch released (e-signature)", batch_id,
          f"Signed by {user['name']} ({user['username']}), meaning: '{meaning}'. "
          f"Certificate {certificate_id} generated.")
    batch = load_batch(batch_id)
    return 200, {"batch": batch, "releaseChecks": checks}
