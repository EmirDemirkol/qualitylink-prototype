// Calls to the QualityLink API (API Gateway -> Lambda). Every request carries
// the Cognito ID token; API Gateway rejects it before Lambda runs if the token
// is missing, expired or forged.
import { CONFIG } from "./config.js";
import { idToken, signOut } from "./auth.js";

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || data?.message || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

export async function api(method, path, body) {
  const res = await fetch(CONFIG.apiUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${idToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.message === "Unauthorized") {
    // API Gateway refused the token: session expired.
    signOut();
    location.hash = "#/login";
    throw new ApiError(401, { error: "Your session expired. Please sign in again." });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
