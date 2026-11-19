"""
Test harness: runs the real Lambda handlers against mocked AWS (moto),
so the backend can be tested on a laptop without an AWS account.
"""
import json
import os
import sys

import boto3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

DEMO_PASSWORD = "Nuvola-Demo-2026"

TABLES = {
    "BATCHES_TABLE": ("ql-batches", [("batchId", "HASH")]),
    "READINGS_TABLE": ("ql-readings", [("batchId", "HASH"), ("readingId", "RANGE")]),
    "DEVIATIONS_TABLE": ("ql-deviations", [("batchId", "HASH"), ("deviationId", "RANGE")]),
    "AUDIT_TABLE": ("ql-audit", [("pk", "HASH"), ("sk", "RANGE")]),
}

# Same routing as template.yaml
ROUTES = {
    "GET /batches": "batches",
    "GET /batches/{batchId}": "batches",
    "GET /batches/{batchId}/certificate": "batches",
    "POST /batches/{batchId}/readings": "inspection",
    "GET /deviations": "deviations",
    "PATCH /batches/{batchId}/deviations/{deviationId}": "deviations",
    "POST /batches/{batchId}/release": "release",
    "GET /audit": "audit_trail",
}

GROUP_OF = {"operator.kelly": "operator", "engineer.murphy": "engineer",
            "qa.walsh": "qa", "client.larsen": "client"}
NAME_OF = {"operator.kelly": "S. Kelly", "engineer.murphy": "A. Murphy",
           "qa.walsh": "C. Walsh", "client.larsen": "M. Larsen"}


def setup_aws():
    """Create mocked tables + Cognito pool, then run the real seed function."""
    os.environ.setdefault("AWS_DEFAULT_REGION", "eu-west-1")
    ddb = boto3.client("dynamodb")
    for env, (name, keys) in TABLES.items():
        ddb.create_table(
            TableName=name,
            AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k, _ in keys],
            KeySchema=[{"AttributeName": k, "KeyType": t} for k, t in keys],
            BillingMode="PAY_PER_REQUEST",
        )
        os.environ[env] = name
    idp = boto3.client("cognito-idp")
    pool = idp.create_user_pool(PoolName="ql", Schema=[
        {"Name": "organisation", "AttributeDataType": "String", "Mutable": True}])["UserPool"]["Id"]
    client = idp.create_user_pool_client(UserPoolId=pool, ClientName="web",
                                         ExplicitAuthFlows=["ALLOW_USER_PASSWORD_AUTH"])["UserPoolClient"]["ClientId"]
    for g in ("operator", "engineer", "qa", "client"):
        idp.create_group(UserPoolId=pool, GroupName=g)
    os.environ.update(USER_POOL_ID=pool, USER_POOL_CLIENT_ID=client, DEMO_PASSWORD=DEMO_PASSWORD)
    import seed
    return seed.handler({}, None)


def claims_for(username):
    c = {"cognito:username": username, "name": NAME_OF[username],
         "cognito:groups": f"[{GROUP_OF[username]}]"}
    if username == "client.larsen":
        c["custom:organisation"] = "Halden Pharma"
    return c


def call(method, path_template, username, path=None, body=None, query=None, claims=None):
    """Invoke the Lambda that owns this route, exactly as API Gateway would."""
    route = f"{method} {path_template}"
    module = __import__(ROUTES[route])
    event = {
        "routeKey": route,
        "pathParameters": path or {},
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"jwt": {"claims": claims or claims_for(username)}}},
    }
    res = module.handler(event, None)
    return res["statusCode"], json.loads(res["body"])
