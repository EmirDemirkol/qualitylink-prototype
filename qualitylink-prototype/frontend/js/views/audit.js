// Audit trail: every action, who did it and when. Read only.
import { api } from "../api.js";
import { esc, fmtTime } from "../ui.js";

const ROLE = { operator: "Operator", engineer: "Quality engineer", qa: "QA approver", client: "Client", system: "System" };

export async function render(el, { params }) {
  const batch = params.get("batch") || "";
  const { entries } = await api("GET", `/audit${batch ? `?batchId=${encodeURIComponent(batch)}` : ""}`);
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Audit trail${batch ? ` · <span class="mono">${esc(batch)}</span>` : ""}</h1>
      <p>Append-only. QualityLink has no way to edit or delete an entry.</p></div>
      <form class="row" id="filter">
        <input type="text" id="b" placeholder="Filter by batch, e.g. B-24117" value="${esc(batch)}" style="width:220px">
        <button class="btn" type="submit">Filter</button>
        ${batch ? `<a class="btn ghost" href="#/audit">Clear</a>` : ""}
      </form>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Batch</th><th>Details</th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td class="small" style="white-space:nowrap">${fmtTime(e.at)}</td>
        <td><strong>${esc(e.actorName)}</strong><br><span class="muted small">${esc(ROLE[e.actorRole] || e.actorRole)}</span></td>
        <td>${esc(e.action)}</td>
        <td class="mono">${e.batchId ? `<a href="#/batches/${encodeURIComponent(e.batchId)}">${esc(e.batchId)}</a>` : ""}</td>
        <td class="small">${esc(e.details)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No entries.</td></tr>`}
      </tbody></table></div>
      <p class="legend">Prototype: stored in DynamoDB, and the app's IAM roles can only add entries. Proposed production design: archived to S3 Object Lock (Part 2).</p>
    </div>`;
  el.querySelector("#filter").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el.querySelector("#b").value.trim();
    location.hash = v ? `#/audit?batch=${encodeURIComponent(v)}` : "#/audit";
  });
}
