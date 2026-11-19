// Small UI helpers shared by every screen.

// The first screen each role lands on after signing in.
export const HOME = { operator: "#/terminal", engineer: "#/batches", qa: "#/release", client: "#/portal" };

// Escape text before putting it into HTML. Every value from the API goes
// through this, which stops stored XSS (e.g. a script typed into a deviation note).
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const STATUS = {
  IN_PRODUCTION: ["In production", "grey"],
  ON_HOLD: ["On hold", "red"],
  READY_FOR_REVIEW: ["Ready for review", "blue"],
  RELEASED: ["Released", "green"],
  REJECTED: ["Rejected", "red"],
  OPEN: ["Open", "red"],
  UNDER_INVESTIGATION: ["Under investigation", "amber"],
  CLOSED: ["Closed", "green"],
  PASS: ["Pass", "green"],
  FAIL: ["Fail", "red"],
};

export function badge(status, labelOverride) {
  const [label, colour] = STATUS[status] || [status, "grey"];
  return `<span class="badge ${colour}">${esc(labelOverride || label)}</span>`;
}

export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtValue(reading) {
  return reading.unit ? `${reading.value} ${reading.unit}` : String(reading.value);
}

export function limitText(spec) {
  return spec.kind === "visual" ? "No defects" : `${spec.min} to ${spec.max} ${spec.unit}`;
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

export const spinner = `<div class="spinner" aria-label="Loading"></div>`;

export const logo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1557b0"/><path d="M9 16.5l4.5 4.5L23 11.5" stroke="white" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const protoBanner = `<div class="proto-banner">QualityLink prototype · CSC1057 Group Nuvola · fictional sample data only</div>`;

export function errorCard(err) {
  return `<div class="notice red"><strong>Something went wrong.</strong> ${esc(err.message || err)}</div>`;
}
