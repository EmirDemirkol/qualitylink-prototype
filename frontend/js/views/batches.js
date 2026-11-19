// Quality engineer / QA: batch list and full batch record (Part 2, Figure 2).
import { api } from "../api.js";
import { badge, esc, fmtTime, fmtValue } from "../ui.js";

export async function renderList(el) {
  const { batches } = await api("GET", "/batches");
  const count = (s) => batches.filter((b) => b.status === s).length;
  el.innerHTML = `
    <div class="page-head"><div><h1>Batches</h1><p>Every batch on the floor, with its live quality status.</p></div></div>
    <div class="row" style="margin-bottom:16px">
      ${badge("ON_HOLD", `${count("ON_HOLD")} on hold`)} ${badge("READY_FOR_REVIEW", `${count("READY_FOR_REVIEW")} ready for review`)}
      ${badge("IN_PRODUCTION", `${count("IN_PRODUCTION")} in production`)} ${badge("RELEASED", `${count("RELEASED")} released`)}
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Batch</th><th>Part</th><th>Client / PO</th><th>Line</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${batches.map((b) => `
        <tr class="clickable ${b.status === "ON_HOLD" ? "fail" : ""}" data-href="#/batches/${encodeURIComponent(b.batchId)}">
          <td class="mono"><a href="#/batches/${encodeURIComponent(b.batchId)}">${esc(b.batchId)}</a></td>
          <td>${esc(b.part)} ${esc(b.partNo)}</td><td>${esc(b.client)}<br><span class="muted small">${esc(b.po)}</span></td>
          <td>${esc(b.line)}</td><td>${badge(b.status)}</td><td>${fmtTime(b.updatedAt)}</td>
        </tr>`).join("")}</tbody></table></div></div>`;
  el.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
}

export function checksList(checks) {
  return `<ul class="checks">${checks.map((c) => `
    <li class="${c.ok ? "ok" : "no"}"><span class="icon">${c.ok ? "✓" : "✕"}</span>
      <div><strong>${esc(c.label)}</strong><br><span class="muted small">${esc(c.detail)}</span></div></li>`).join("")}</ul>`;
}

function nextStep(batch, openDev, role) {
  switch (batch.status) {
    case "ON_HOLD": return `Investigate in the deviation record. The batch cannot be released while ${esc(openDev?.deviationId || "a deviation")} is open (FR03, FR07).`;
    case "READY_FOR_REVIEW": return role === "qa" ? "All results are in. Review the release checks and sign." : "All results are in. Waiting for a QA approver to review and sign.";
    case "RELEASED": return `Released by ${esc(batch.releasedByName)} on ${fmtTime(batch.releasedAt)}. Certificate ${esc(batch.certificateId)} is available to ${esc(batch.client)}.`;
    case "REJECTED": return "Batch rejected after investigation. It can never be released.";
    default: return "Production in progress. Results appear here as operators record them.";
  }
}

export async function renderDetail(el, { user, args }) {
  const [batchId] = args;
  const { batch, readings, deviations, releaseChecks } = await api("GET", `/batches/${encodeURIComponent(batchId)}`);
  const openDev = deviations.find((d) => d.status !== "CLOSED");
  const label = (t) => batch.spec.checks[t]?.label || t;

  el.innerHTML = `
    <div class="crumbs"><a href="#/batches">Batches</a> / ${esc(batch.batchId)}</div>
    <div class="page-head">
      <div><h1 class="mono">${esc(batch.batchId)} ${badge(batch.status)}</h1>
        ${batch.status === "ON_HOLD" ? `<p class="error-text">Shipping blocked by QualityLink</p>` : ""}</div>
      <div class="row">
        <a class="btn" href="#/audit?batch=${encodeURIComponent(batch.batchId)}">Audit trail</a>
        ${openDev ? `<a class="btn primary" href="#/deviations/${encodeURIComponent(batch.batchId)}/${encodeURIComponent(openDev.deviationId)}">Open deviation ${esc(openDev.deviationId)}</a>` : ""}
        ${user.role === "qa" && batch.status === "READY_FOR_REVIEW" ? `<a class="btn primary" href="#/release/${encodeURIComponent(batch.batchId)}">Review and release</a>` : ""}
        ${batch.status === "RELEASED" ? `<a class="btn" href="#/certificate/${encodeURIComponent(batch.batchId)}">Certificate</a>` : ""}
      </div>
    </div>

    <div class="card"><div class="kv">
      <div><span>Part</span><strong>${esc(batch.part)} ${esc(batch.partNo)}</strong></div>
      <div><span>Work order / PO</span><strong>${esc(batch.workOrder)} / ${esc(batch.po)}</strong></div>
      <div><span>Client</span><strong>${esc(batch.client)}</strong></div>
      <div><span>Spec</span><strong>${esc(batch.spec.id)} rev ${esc(batch.spec.rev)}</strong></div>
      <div><span>Line</span><strong>${esc(batch.line)}</strong></div>
    </div></div>

    <div class="card">
      <h2>Inspection results</h2>
      ${readings.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Check</th><th>Reading</th><th>Limit</th><th>Result</th><th>By / source</th></tr></thead>
        <tbody>${readings.map((r) => `<tr class="${r.result === "FAIL" ? "fail" : ""}">
          <td>${fmtTime(r.recordedAt)}</td><td>${esc(label(r.inspectionType))}</td>
          <td class="mono"><strong>${esc(fmtValue(r))}</strong></td><td class="small">${esc(r.limit)}</td><td>${badge(r.result)}</td>
          <td class="small">${esc(r.recordedByName)} · ${esc(r.terminal)}${r.offline ? `<br><span class="badge amber">Offline, synced ${fmtTime(r.syncedAt)}</span>` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="empty">No results recorded yet.</p>`}
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card" style="margin:0">
        <h2>Deviations</h2>
        ${deviations.length ? deviations.map((d) => `
          <p style="margin:0 0 10px"><a class="mono" href="#/deviations/${encodeURIComponent(batch.batchId)}/${encodeURIComponent(d.deviationId)}">${esc(d.deviationId)}</a>
          ${badge(d.status)}<br><span class="small">${esc(d.title)}</span></p>`).join("") : `<p class="muted">None.</p>`}
        <h3 style="margin-top:16px">What happens next</h3><p class="small">${nextStep(batch, openDev, user.role)}</p>
      </div>
      <div class="card" style="margin:0"><h2>Release checks</h2>${checksList(releaseChecks)}</div>
    </div>`;
}
