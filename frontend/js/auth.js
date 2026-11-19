// Sign-in with Amazon Cognito (no SDK needed: it is one HTTPS call).
// Tokens are kept in sessionStorage, so closing the tab signs you out.
import { CONFIG } from "./config.js";

const KEY = "ql.session";

export async function signIn(username, password) {
  const res = await fetch(CONFIG.cognitoEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CONFIG.userPoolClientId,
      AuthParameters: { USERNAME: username.trim(), PASSWORD: password },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.AuthenticationResult) {
    throw new Error(data.message || "Incorrect username or password.");
  }
  sessionStorage.setItem(KEY, JSON.stringify({ idToken: data.AuthenticationResult.IdToken }));
  return currentUser();
}

export function signOut() {
  sessionStorage.removeItem(KEY);
}

export function idToken() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null")?.idToken || null;
  } catch {
    return null;
  }
}

// Read the user's details from the ID token. This is only for showing the
// right screens: the API checks the token signature and role on every call.
export function currentUser() {
  const token = idToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp * 1000 < Date.now()) { signOut(); return null; }
    const groups = payload["cognito:groups"] || [];
    const role = ["qa", "engineer", "operator", "client"].find((r) => groups.includes(r));
    return {
      username: payload["cognito:username"],
      name: payload.name || payload["cognito:username"],
      role,
      organisation: payload["custom:organisation"],
    };
  } catch {
    signOut();
    return null;
  }
}
