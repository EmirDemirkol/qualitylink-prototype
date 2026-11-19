"""
Run the whole prototype on your laptop with no AWS account:
    python tests/local_server.py      then open http://localhost:8765

AWS is mocked with moto. A fake Cognito endpoint issues unsigned test
tokens, and requests are routed to the real Lambda handlers the same way
API Gateway does. For local testing only.
"""
import base64
import json
import mimetypes
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from moto import mock_aws

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import DEMO_PASSWORD, GROUP_OF, NAME_OF, ROUTES, setup_aws  # noqa: E402

PORT = int(os.environ.get("PORT", "8765"))
FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
LOCAL_CONFIG = f"""export const CONFIG = {{
  region: "local", apiUrl: "http://localhost:{PORT}/api", userPoolClientId: "local",
  cognitoEndpoint: "http://localhost:{PORT}/cognito",
}};"""
ROUTE_PATTERNS = [(r, re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", r.split(" ", 1)[1]) + "$"))
                  for r in ROUTES]


def b64(data):
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def fake_token(username):
    claims = {"cognito:username": username, "name": NAME_OF[username],
              "cognito:groups": [GROUP_OF[username]], "exp": int(time.time()) + 3600}
    if username == "client.larsen":
        claims["custom:organisation"] = "Halden Pharma"
    return f"{b64({'alg': 'none'})}.{b64(claims)}.local"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type, x-amz-target")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode() if n else None

    def _api(self, method):
        path, _, qs = self.path[len("/api"):].partition("?")
        auth = self.headers.get("Authorization", "")
        try:
            payload = auth.split()[1].split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            claims["cognito:groups"] = "[" + " ".join(claims["cognito:groups"]) + "]"
        except Exception:
            return self._send(401, {"message": "Unauthorized"})
        for route, pattern in ROUTE_PATTERNS:
            if not route.startswith(method + " "):
                continue
            m = pattern.match(path)
            if m:
                module = __import__(ROUTES[route])
                query = dict(p.split("=", 1) for p in qs.split("&") if "=" in p) or None
                if query:
                    from urllib.parse import unquote
                    query = {k: unquote(v) for k, v in query.items()}
                event = {"routeKey": route, "pathParameters": m.groupdict(), "queryStringParameters": query,
                         "body": self._body(), "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
                res = module.handler(event, None)
                return self._send(res["statusCode"], res["body"].encode())
        self._send(404, {"message": "Not Found"})

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        rel = self.path.split("?")[0].lstrip("/") or "index.html"
        if rel == "js/config.js":
            return self._send(200, LOCAL_CONFIG.encode(), "text/javascript")
        full = os.path.realpath(os.path.join(FRONTEND, rel))
        if not full.startswith(os.path.realpath(FRONTEND)) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        with open(full, "rb") as f:
            self._send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    def do_POST(self):
        if self.path == "/cognito":
            req = json.loads(self._body() or "{}")
            p = req.get("AuthParameters", {})
            if p.get("USERNAME") in GROUP_OF and p.get("PASSWORD") == DEMO_PASSWORD:
                return self._send(200, {"AuthenticationResult": {"IdToken": fake_token(p["USERNAME"])}})
            return self._send(400, {"__type": "NotAuthorizedException", "message": "Incorrect username or password."})
        if self.path.startswith("/api/"):
            return self._api("POST")
        self._send(404, {"message": "Not Found"})

    def do_PATCH(self):
        self._api("PATCH")


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    with mock_aws():
        print(setup_aws())
        print(f"QualityLink local: http://localhost:{PORT}")
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
