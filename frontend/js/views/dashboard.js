// Quality KPI dashboard: live numbers from GET /metrics (Lambda reading DynamoDB).
import { api } from "../api.js";
import { badge, esc, fmtTime } from "../ui.js";

const STATUS_LABEL = {
  IN_PRODUCTION: "In production", ON_HOLD: "On hold", READY_FOR_REVIEW: "Ready for review",
  RELEASED: "Released", REJECTED: "Rejected",
};

const num = (v, suffix = "") => (v === null || v === undefined ? "–" : `${v}${suffix}`);

function tile(label, value, sub, tone = "") {
  return `<div class="kpi ${tone}"><span class="kpi-label">${esc(label)}</span>
    <strong class="kpi-value">${value}</strong><span class="kpi-sub">${sub}</span></div>`;
}

// Horizontal bars: one series, so one colour; the label and number carry the meaning.
function bars(rows, labelOf, tone) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar" title="${esc(labelOf(r))}: ${r.count}">
      <span class="hbar-label">${esc(labelOf(r))}</span>
      <span class="hbar-track"><span class="hbar-fill ${tone}" style="width:${(r.count / max) * 100}%"></span></span>
      <span class="hbar-num">${r.count}</span>
    </div>`).join("")}</div>`;
}

export async function render(el) {
  const m = await api("GET", "/metrics");
  const k = m.kpis;
  const release = k.avgHoursToRelease;
  const onTarget = release !== null && release <= k.releaseTargetHours;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Quality dashboard</h1>
      <p>Live from the batch, inspection and deviation records · updated ${fmtTime(m.generatedAt)}</p></div>
      <button class="btn" id="refresh">Refresh</button>
    </div>

    <div class="kpis">
      ${tile("Batches on hold", k.batchesOnHold,
        k.batchesOnHold ? "Blocked from shipping until a deviation is closed" : "Nothing blocked",
        k.batchesOnHold ? "bad" : "good")}
      ${tile("Open deviations", k.openDeviations,
        k.oldestOpenDeviationHours !== null ? `Oldest open for ${k.oldestOpenDeviationHours} h` : "None open",
        k.openDeviations ? "warn" : "good")}
      ${tile("First-pass yield", num(k.firstPassYieldPct, "%"),
        `${k.batchesInspected} batches inspected · ${num(k.readingPassRatePct, "%")} of ${k.readingsTotal} results passed`)}
      ${tile("Avg time to release", num(release, " h"),
        release === null ? "No releases yet"
          : `First inspection to QA sign-off · target ${k.releaseTargetHours} h ${onTarget ? "(met)" : "(missed)"}`,
        release === null ? "" : onTarget ? "good" : "warn")}
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card"><h2>Batches by status</h2>
        ${bars(m.statusCounts, (r) => STATUS_LABEL[r.status] || r.status, "blue")}
      </div>
      <div class="card"><h2>Failures by check</h2>
        <p class="muted small" style="margin-top:-6px">Biggest cause first, so engineers know where to look.</p>
        ${m.failuresByCheck.length ? bars(m.failuresByCheck, (r) => r.check, "blue")
          : `<p class="empty">No failed results.</p>`}
      </div>
    </div>

    <div class="card">
      <h2>Recent failed results</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Batch</th><th>Check</th><th>Value</th><th>Recorded</th><th>Deviation</th></tr></thead>
        <tbody>${m.recentFailures.map((f) => `
          <tr><td class="mono"><a href="#/batches/${encodeURIComponent(f.batchId)}">${esc(f.batchId)}</a></td>
            <td>${esc(f.check)}</td><td class="mono">${esc(f.value)} ${esc(f.unit)}</td>
            <td>${fmtTime(f.recordedAt)} · ${esc(f.recordedByName)}</td>
            <td>${f.deviationId ? `<a class="mono" href="#/deviations/${encodeURIComponent(f.batchId)}/${encodeURIComponent(f.deviationId)}">${esc(f.deviationId)}</a>` : "–"}</td></tr>`).join("")
          || `<tr><td colspan="5" class="empty">No failed results.</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Open deviations by age</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Deviation</th><th>Batch</th><th>What happened</th><th>Status</th><th>Open for</th></tr></thead>
        <tbody>${m.openDeviations.map((d) => `
          <tr><td class="mono"><a href="#/deviations/${encodeURIComponent(d.batchId)}/${encodeURIComponent(d.deviationId)}">${esc(d.deviationId)}</a></td>
            <td class="mono">${esc(d.batchId)}</td><td>${esc(d.title)}</td><td>${badge(d.status)}</td>
            <td>${esc(d.ageHours)} h</td></tr>`).join("")
          || `<tr><td colspan="5" class="empty">No open deviations.</td></tr>`}</tbody>
      </table></div>
    </div>

    <p class="muted small">Prototype: these numbers are calculated live by a read-only Lambda. In production they would be
      pre-aggregated (DynamoDB Streams to a metrics table) so the dashboard never scans the live tables.</p>`;

  el.querySelector("#refresh").addEventListener("click", () => render(el));
}
