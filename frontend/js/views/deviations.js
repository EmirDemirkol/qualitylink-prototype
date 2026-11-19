// Deviations: list and investigation record (Part 2, Figure 2 right).
import { api } from "../api.js";
import { badge, esc, fmtTime, fmtValue, toast } from "../ui.js";

export async function renderList(el) {
  const { deviations } = await api("GET", "/deviations");
  el.innerHTML = `
    <div class="page-head"><div><h1>Deviations</h1><p>Opened automatically when a result fails its specification.</p></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Deviation</th><th>Batch</th><th>What happened</th><th>Status</th><th>Opened</th></tr></thead>
      <tbody>${deviations.map((d) => {
        const href = `#/deviations/${encodeURIComponent(d.batchId)}/${encodeURIComponent(d.deviationId)}`;
        return `<tr class="clickable" data-href="${href}"><td class="mono"><a href="${href}">${esc(d.deviationId)}</a></td>
          <td class="mono">${esc(d.batchId)}</td><td>${esc(d.title)}</td><td>${badge(d.status)}</td><td>${fmtTime(d.openedAt)}</td></tr>`;
      }).join("") || `<tr><td colspan="5" class="empty">No deviations.</td></tr>`}</tbody></table></div></div>`;
  el.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
}

export async function renderDetail(el, { user, args, rerender }) {
  const [batchId, devId] = args;
  const { batch, readings, deviations } = await api("GET", `/batches/${encodeURIComponent(batchId)}`);
  const dev = deviations.find((d) => d.deviationId === devId);
  if (!dev) { el.innerHTML = `<div class="notice red">Deviation not found.</div>`; return; }
  const reading = readings.find((r) => r.readingId === dev.readingId);
  const canEdit = user.role === "engineer" && dev.status !== "CLOSED";
  const steps = ["OPEN", "UNDER_INVESTIGATION", "CLOSED"];
  const at = steps.indexOf(dev.status);

  el.innerHTML = `
    <div class="crumbs"><a href="#/batches/${encodeURIComponent(batchId)}">${esc(batchId)}</a> / ${esc(devId)}</div>
    <div class="page-head">
      <div><h1>Deviation <span class="mono">${esc(devId)}</span> ${badge(dev.status)}</h1>
      <p>Linked to batch ${esc(batchId)} · opened ${fmtTime(dev.openedAt)} by ${esc(dev.openedBy)}</p></div>
      <a class="btn" href="#/audit?batch=${encodeURIComponent(batchId)}">Audit trail</a>
    </div>
    <div class="stepper">
      ${["Open", "Under investigation", "Closed"].map((s, i) => `<div class="${i === at ? "on" : i < at ? "past" : ""}"><span>Step ${i + 1}</span><strong>${s}</strong></div>`).join("")}
    </div>
    <div class="card">
      <h2>What happened</h2>
      <p style="margin:0">${esc(dev.description)}</p>
      ${reading ? `<p class="muted small">Reading ${esc(reading.readingId)}: <span class="mono">${esc(fmtValue(reading))}</span> · ${esc(reading.recordedByName)} · ${fmtTime(reading.recordedAt)}</p>` : ""}
    </div>
    <form class="card" id="devform">
      <h2>Investigation</h2>
      <div class="field"><label for="inv">Investigation notes</label>
        <textarea id="inv" ${canEdit ? "" : "readonly"} placeholder="What was checked, e.g. gauge inspection, re-measurement of retained parts">${esc(dev.investigation)}</textarea></div>
      <div class="field"><label for="rc">Root cause</label>
        <textarea id="rc" ${canEdit ? "" : "readonly"} placeholder="Required before closing">${esc(dev.rootCause)}</textarea></div>
      ${dev.status === "CLOSED" ? `
        <div class="notice ${dev.outcome === "REJECT" ? "red" : "green"}"><strong>Closed by ${esc(dev.closedBy)} on ${fmtTime(dev.closedAt)}.</strong>
        Outcome: ${dev.outcome === "REJECT" ? "batch rejected" : "batch acceptable, hold cleared"}.</div>` : ""}
      ${canEdit ? `
        <div class="grid-2">
          <div class="field"><label for="outcome">Outcome (for closing)</label>
            <select id="outcome"><option value="">Not decided yet</option>
              <option value="ACCEPT">Batch acceptable: no impact on product quality</option>
              <option value="REJECT">Batch rejected</option></select></div>
          <div class="field"><label for="reason">Reason for change (logged)</label>
            <input type="text" id="reason" placeholder="Required for every edit" maxlength="300"></div>
        </div>
        <p id="err" class="error-text" role="alert"></p>
        <div class="row spread">
          <span class="muted small">Every change is saved to the audit trail with your name, the time and the reason.</span>
          <div class="row">
            ${dev.status === "OPEN" ? `<button class="btn primary" data-act="start">Start investigation</button>` : `
              <button class="btn" data-act="save">Save notes</button>
              <button class="btn primary" data-act="close">Close deviation</button>`}
          </div>
        </div>` : user.role === "qa" && dev.status !== "CLOSED" ? `<p class="muted small">Read only: deviations are investigated and closed by a quality engineer.</p>` : ""}
    </form>`;

  el.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const action = btn.dataset.act;
    const form = el.querySelector("#devform");
    const payload = {
      action,
      investigation: form.querySelector("#inv").value,
      rootCause: form.querySelector("#rc").value,
      reasonForChange: form.querySelector("#reason").value,
      outcome: form.querySelector("#outcome").value || undefined,
    };
    btn.disabled = true;
    try {
      const res = await api("PATCH", `/batches/${encodeURIComponent(batchId)}/deviations/${encodeURIComponent(devId)}`, payload);
      toast(action === "close" ? `${devId} closed. Batch is now ${res.batchStatus.replaceAll("_", " ").toLowerCase()}.` : "Saved to the record");
      rerender();
    } catch (err) {
      el.querySelector("#err").textContent = err.message;
      btn.disabled = false;
    }
  }));
}
