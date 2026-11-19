"""
Audit Trail module (read side).

GET /audit?batchId=B-24117   newest entries first, optionally for one batch

Writing to the audit trail happens inside every other module (common.audit).
This Lambda's IAM role can only Query the audit table: it cannot change it.
"""
from boto3.dynamodb.conditions import Attr, Key

from common import ENGINEER, QA, api_handler, audit_log, get_user, query_param, require_role

MAX_ENTRIES = 300


@api_handler
def handler(event, context):
    user = get_user(event)
    require_role(user, ENGINEER, QA)
    batch_id = query_param(event, "batchId")

    kwargs = {
        "KeyConditionExpression": Key("pk").eq("AUDIT"),
        "ScanIndexForward": False,  # newest first
    }
    if batch_id:
        kwargs["FilterExpression"] = Attr("batchId").eq(batch_id)

    items = []
    while len(items) < MAX_ENTRIES:
        page = audit_log().query(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    return 200, {"entries": items[:MAX_ENTRIES]}
