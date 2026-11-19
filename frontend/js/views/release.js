// QA Approver: release queue, release checks and electronic signature
// (Part 2, Figure 3). Only this screen can trigger a release.
import { api } from "../api.js";
import { badge, esc, fmtTime, toast } from "../ui.js";
import { checksList } from "./batches.js";

export async function render(el, { user, args, rerender }) {
  const { batches } = await api("GET", "/batches");
  const ready = batches.filter((b) => b.status === "READY_FOR_REVIEW");
  const blocked = batches.filter((b) => b.status === "ON_HOLD");
  const released = batches.filter((b) => b.status === "RELEASED").slice(0, 4);
  const selectedId = args[0] || ready[0]?.batchId || blocked[0]?.batchId;

  const item = (b) => `
    <button class="queue-item ${b.batchId === selectedId ? "selected" : ""}" data-id="${esc(b.batchId)}">
      <strong class="mono">${esc(b.batchId)}</strong> ${badge(b.status)}<br>
      <span class="small muted">${esc(b.part)} ${esc(b.partNo)} · ${esc(b.line)}</span></button>`;

  el.innerHTML = `
    <div class="page-head"><div><h1>Release queue</h1><p>Review the full batch record, then sign. Sample data.</p></div></div>
    <div class="release-grid">
      <div>
        <h3 style="margin-bottom:8px">Ready for review (${ready.length})</h3>${ready.map(item).join("") || `<p class="muted small">Nothing waiting.</p>`}
        <h3 style="margin:16px 0 8px">Blocked (${blocked.length})</h3>${blocked.map(item).join("") || `<p class="muted small">None.</p>`}
        <h3 style="margin:16px 0 8px">Recently released</h3>${released.map(item).join("") || `<p class="muted small">None.</p>`}
      </div>
      <div id="panel">${selectedId ? "" : `<div class="card empty">No batches to review.</div>`}</div>
    </div>`;

  el.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => {
    location.hash = `#/release/${encodeURIComponent(b.dataset.id)}`;
  }));
  if (selectedId) await renderPanel(el.querySelector("#panel"), selectedId, user, rerender);
}

async function renderPanel(panel, batchId, user, rerender) {
  const { batch, releaseChecks } = await api("GET", `/batches/${encodeURIComponent(batchId)}`);
  const allOk = releaseChecks.every((c) => c.ok);
  const enc = encodeURIComponent(batchId);

  if (batch.status === "RELEASED") {
    panel.innerHTML = `
      <div class="card"><h2>Release checks for <span class="mono">${esc(batchId)}</span></h2>${checksList(releaseChecks.filter((c) => c.id !== "state" && c.id !== "independent"))}</div>
      <div class="notice green" style="margin-top:16px">
        <h2 style="margin-bottom:6px">✓ ${esc(batchId)} released</h2>
        <p style="margin:0">Signed by <strong>${esc(batch.releasedByName)}</strong> · "${esc(batch.signatureMeaning)}" · ${fmtTime(batch.releasedAt)}<br>
        Certificate <strong>${esc(batch.certificateId)}</strong> generated. ${esc(batch.client)} can now download it.</p>
        <p style="margin:10px 0 0"><a href="#/audit?batch=${enc}">See audit entry</a> · <a href="#/certificate/${enc}">View certificate</a></p>
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="card">
      <div class="row spread"><h2>Release checks for <span class="mono">${esc(batchId)}</span></h2><a href="#/batches/${enc}" class="small">View full batch record</a></div>
      ${checksList(releaseChecks)}
    </div>
    <form class="card" id="sign">
      <h2>Electronic signature</h2>
      <div class="grid-2">
        <div class="field"><label for="meaning">Meaning of signature</label>
          <select id="meaning"><option>Approved for release</option></select></div>
        <div class="field"><label for="pw">Re-enter your password</label>
          <input type="password" id="pw" autocomplete="current-password" required placeholder="Required at the moment of signing"></div>
      </div>
      <p class="small muted">By signing you confirm you have reviewed the complete batch record. Your signature (${esc(user.name)}, date, time and meaning) is permanently linked to this record (21 CFR Part 11).</p>
      <p id="err" class="error-text" role="alert"></p>
      <button class="btn primary" type="submit" ${allOk ? "" : "disabled"}>Sign and release ${esc(batchId)}</button>
      ${allOk ? "" : `<p class="small muted" style="margin-bottom:0">Signing is disabled until every release check passes.</p>`}
    </form>`;

  panel.querySelector("#sign").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Signing...";
    try {
      await api("POST", `/batches/${enc}/release`, {
        meaning: e.target.querySelector("#meaning").value,
        password: e.target.querySelector("#pw").value,
      });
      toast(`${batchId} released`);
      await rerender(); // refresh the queue and show the signed record
    } catch (err) {
      e.target.querySelector("#pw").value = "";
      panel.querySelector("#err").textContent = err.message;
      btn.disabled = false; btn.textContent = `Sign and release ${batchId}`;
    }
  });
}
