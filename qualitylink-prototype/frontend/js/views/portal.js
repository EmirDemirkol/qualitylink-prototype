// Halden Pharma client portal (Part 2, Figure 4) and the Certificate of
// Conformance. Clients only ever receive their own batches from the API.
import { api } from "../api.js";
import { badge, esc, fmtTime } from "../ui.js";

const CLIENT_LABEL = { READY_FOR_REVIEW: "In QA review" };

export async function renderPortal(el, { user }) {
  const { batches } = await api("GET", "/batches");
  const held = batches.filter((b) => b.status === "ON_HOLD");
  el.innerHTML = `
    <h1>Your batches</h1>
    <p class="muted">You only see batches made for ${esc(user.organisation)}. Sample data.</p>
    ${held.map((b) => `<div class="notice amber" style="margin:14px 0">
      <strong>Hold notice · ${esc(b.batchId)} (${esc(b.part)} ${esc(b.partNo)})</strong><br>
      <span class="small">${esc(b.holdNotice || "Held by Meridian quality.")} You will see the status change here.</span></div>`).join("")}
    <div class="card" style="margin-top:16px"><div class="table-wrap"><table>
      <thead><tr><th>Batch</th><th>Part</th><th>PO</th><th>Status</th><th>Updated</th><th>Certificate</th></tr></thead>
      <tbody>${batches.map((b) => `<tr>
        <td class="mono">${esc(b.batchId)}</td><td>${esc(b.part)} ${esc(b.partNo)}</td><td>${esc(b.po)}</td>
        <td>${badge(b.status, CLIENT_LABEL[b.status])}</td><td>${fmtTime(b.updatedAt)}</td>
        <td>${b.certificateAvailable ? `<a class="btn" href="#/certificate/${encodeURIComponent(b.batchId)}">Download CoC</a>` : `<span class="muted small">Available after release</span>`}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">No batches.</td></tr>`}</tbody></table></div></div>
    <p class="muted small" style="margin-top:14px">Questions about a batch? Contact your Meridian quality contact. This portal is read-only.</p>`;
}

export async function renderCertificate(el, { user, args }) {
  const [batchId] = args;
  const { certificate: c } = await api("GET", `/batches/${encodeURIComponent(batchId)}/certificate`);
  const back = user.role === "client" ? "#/portal" : `#/batches/${encodeURIComponent(batchId)}`;
  el.innerHTML = `
    <div class="row spread no-print" style="max-width:820px;margin:0 auto 14px">
      <a href="${back}">← Back</a>
      <button class="btn primary" id="print">Print / Save as PDF</button>
    </div>
    <article class="certificate">
      <div class="cert-head">
        <div><h1>Certificate of Conformance</h1><p class="muted" style="margin:6px 0 0">Meridian Medical Components · Prototype, sample data</p></div>
        <div style="text-align:right"><strong class="mono">${esc(c.certificateId)}</strong><br><span class="small muted">Issued ${fmtTime(c.releasedAt)}</span></div>
      </div>
      <div class="kv">
        <div><span>Customer</span><strong>${esc(c.client)}</strong></div>
        <div><span>Purchase order</span><strong>${esc(c.po)}</strong></div>
        <div><span>Batch</span><strong class="mono">${esc(c.batchId)}</strong></div>
        <div><span>Part</span><strong>${esc(c.part)} ${esc(c.partNo)}</strong></div>
        <div><span>Work order</span><strong>${esc(c.workOrder)}</strong></div>
        <div><span>Specification</span><strong>${esc(c.spec)}</strong></div>
      </div>
      <h2 style="margin:26px 0 8px">Inspection summary</h2>
      <table><thead><tr><th>Check</th><th>Limit</th><th>Samples</th><th>Result</th></tr></thead>
        <tbody>${c.results.map((r) => `<tr><td>${esc(r.check)}</td><td>${esc(r.limit)}</td><td>${esc(r.samples)}</td><td>${esc(r.result)}</td></tr>`).join("")}</tbody></table>
      <p style="margin-top:20px">We certify that the batch above was manufactured and inspected in accordance with the stated specification and conforms to it.</p>
      <div class="sig">
        <strong>Electronically signed</strong><br>
        ${esc(c.releasedBy)}, QA approver · "${esc(c.signatureMeaning)}" · ${esc(new Date(c.releasedAt).toLocaleString("en-IE"))}<br>
        <span class="small muted">Signature applied in QualityLink with password re-authentication and recorded in the audit trail.</span>
      </div>
    </article>`;
  el.querySelector("#print").addEventListener("click", () => window.print());
}
