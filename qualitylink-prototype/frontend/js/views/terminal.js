// Line Terminal (Part 2, Figure 1). Big controls for operators wearing gloves.
// Records inspection results; a fail holds the batch immediately.
import { api } from "../api.js";
import * as gateway from "../gateway.js";
import { badge, esc, fmtTime, fmtValue, limitText, logo, protoBanner, toast } from "../ui.js";

const TERMINAL = "T-03";
const ORDER = ["visual", "airflow", "force", "dimensional"];
const state = { batchId: null, type: null, value: "", visual: null, batches: [], detail: null, usingCache: false };

function localCheck(spec, value) {
  // Same rule as the cloud Specification Check, run on the "gateway" so the
  // operator gets an answer even when the internet is down.
  if (spec.kind === "visual") return value;
  const n = Number(value);
  return n >= Number(spec.min) && n <= Number(spec.max) ? "PASS" : "FAIL";
}

async function load() {
  state.usingCache = false;
  if (gateway.isOffline()) {
    state.batches = gateway.cachedBatches();
    state.detail = null;
    return;
  }
  try {
    const { batches } = await api("GET", "/batches");
    state.batches = batches;
    gateway.cacheBatches(batches); // the gateway keeps a copy of the approved specs
  } catch (err) {
    if (err.status) throw err;
    state.batches = gateway.cachedBatches();
    state.usingCache = true;
  }
  const usable = state.batches.filter(recordable);
  if (!state.batchId || !state.batches.some((b) => b.batchId === state.batchId)) {
    state.batchId = (usable.find((b) => b.batchId === "B-24121") || usable[0] || {}).batchId || null;
  }
  state.detail = null;
  if (state.batchId) {
    try { state.detail = await api("GET", `/batches/${encodeURIComponent(state.batchId)}`); } catch { /* optional panel */ }
  }
}

const recordable = (b) => ["IN_PRODUCTION", "READY_FOR_REVIEW"].includes(b.status);
const visible = (b) => recordable(b) || b.status === "ON_HOLD";

function current() {
  return state.batches.find((b) => b.batchId === state.batchId);
}

function view(user) {
  const offline = gateway.isOffline();
  const q = gateway.queue();
  const batch = current();
  const checks = batch ? ORDER.filter((k) => batch.spec.checks[k]) : [];
  if (batch && !checks.includes(state.type)) state.type = checks[0];
  const spec = batch && state.type ? batch.spec.checks[state.type] : null;
  const recordedTypes = new Set((state.detail?.readings || []).map((r) => r.inspectionType));

  let liveBadge = "";
  if (spec && spec.kind !== "visual" && state.value !== "" && !Number.isNaN(Number(state.value))) {
    liveBadge = localCheck(spec, state.value) === "PASS"
      ? `<span class="badge green">Within limit</span>` : `<span class="badge red">Outside limit</span>`;
  }
  const canSave = batch && recordable(batch) && spec &&
    (spec.kind === "visual" ? Boolean(state.visual) : state.value !== "" && !Number.isNaN(Number(state.value)));

  return `
  <div class="terminal">
    <header class="topbar">
      <div class="brand">${logo}<span>QualityLink</span></div>
      <span class="meta">${esc(batch?.line || "Line")} · Terminal ${TERMINAL}</span>
      <div class="right">
        <button class="gateway-pill ${offline ? "offline" : "online"}" id="gw" title="Simulate an internet outage">
          ${offline ? `● Offline · ${q.length} waiting to sync` : `● Online · synced`}
        </button>
        <span class="meta">${esc(user.name)} · Operator</span>
        <button class="btn" data-action="signout">Sign out</button>
      </div>
    </header>

    <div class="term-body">
      <section>
        ${state.usingCache ? `<div class="notice amber" style="margin-bottom:12px">Cloud not reachable. Using the specs cached on the gateway.</div>` : ""}
        <div class="card">
          <div class="step-label" style="margin-top:0">1. Batch</div>
          <div class="batch-pick">
            ${state.batches.filter(visible).map((b) => `
              <button class="batch-chip ${b.batchId === state.batchId ? "selected" : ""}" data-batch="${esc(b.batchId)}" ${recordable(b) ? "" : "disabled"}>
                <strong>${esc(b.batchId)}</strong>${esc(b.part)} ${esc(b.partNo)}<br>${badge(b.status)}
              </button>`).join("") || `<p class="muted">No batches in production.</p>`}
          </div>
          ${batch ? `
          <div class="kv" style="margin-top:14px">
            <div><span>Part</span><strong>${esc(batch.part)} ${esc(batch.partNo)}</strong></div>
            <div><span>Work order</span><strong>${esc(batch.workOrder)}</strong></div>
            <div><span>Spec</span><strong>${esc(batch.spec.id)} rev ${esc(batch.spec.rev)}</strong></div>
          </div>` : ""}
        </div>

        ${batch ? `
        <div class="card">
          ${recordable(batch) ? "" : `<div class="notice red" style="margin-bottom:12px"><strong>${esc(batch.batchId)} is on hold.</strong> Recording is blocked until a quality engineer clears the hold.</div>`}
          <div class="step-label" style="margin-top:0">2. Choose inspection</div>
          <div class="tiles">
            ${checks.map((k) => `<button class="tile ${k === state.type ? "selected" : ""} ${recordedTypes.has(k) ? "done" : ""}" data-type="${k}">${esc(batch.spec.checks[k].label)}</button>`).join("")}
          </div>

          <div class="step-label">3. ${spec.kind === "visual" ? "Visual check" : `Gauge reading: ${esc(spec.label)}`}</div>
          ${spec.kind === "visual" ? `
            <div class="passfail">
              <button class="tile pass ${state.visual === "PASS" ? "selected" : ""}" data-visual="PASS">✓ Pass</button>
              <button class="tile fail ${state.visual === "FAIL" ? "selected" : ""}" data-visual="FAIL">✕ Fail</button>
            </div>` : `
            <div class="reading-box">
              <input class="reading-input" id="reading" type="number" step="0.01" inputmode="decimal" aria-label="${esc(spec.label)} reading" value="${esc(state.value)}" placeholder="0.0">
              <span class="unit">${esc(spec.unit)}</span>
              <span id="live" style="padding-bottom:14px">${liveBadge}</span>
            </div>
            <p class="muted small">Limit ${esc(limitText(spec))} (${esc(batch.spec.id)} rev ${esc(batch.spec.rev)}), checked automatically.</p>
            <button class="btn" id="simulate">Simulate gauge reading</button>`}
          <div class="save-row"><button class="btn primary big" id="save" ${canSave ? "" : "disabled"}>Save result</button></div>
        </div>` : ""}
      </section>

      <aside>
        <div class="card">
          <h2>Line gateway</h2>
          ${offline ? `
            <div class="notice red small">Internet outage simulated. Results are checked and stored on the gateway, then synced automatically when the connection returns (store-and-forward, QR04).</div>
            ${q.length ? `<ul class="queue-list">${q.map((r) => `<li>${esc(r.batchId)} · ${esc(r.label)} ${esc(r.display)} · ${fmtTime(r.recordedAt)}</li>`).join("")}</ul>` : `<p class="muted small">Nothing waiting.</p>`}`
          : `<p class="muted small" style="margin:0">Connected to AWS. Click the green status button above to simulate an internet outage.</p>`}
        </div>
        ${state.detail ? `
        <div class="card">
          <h2>Results for ${esc(state.batchId)}</h2>
          ${state.detail.readings.length ? `<div class="table-wrap"><table><tbody>
            ${state.detail.readings.slice().reverse().map((r) => `<tr class="${r.result === "FAIL" ? "fail" : ""}">
              <td>${esc(batch.spec.checks[r.inspectionType]?.label || r.inspectionType)}<br><span class="muted small">${fmtTime(r.recordedAt)}${r.offline ? " · offline" : ""}</span></td>
              <td class="mono">${esc(fmtValue(r))}</td><td>${badge(r.result)}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">No results yet.</p>`}
        </div>` : ""}
      </aside>
    </div>
    <div id="overlay"></div>
  </div>${protoBanner}`;
}

function showResult(el, { result, batch, spec, display, deviationId, offline, error }) {
  const host = el.querySelector("#overlay");
  if (error) {
    host.innerHTML = `<div class="overlay"><div class="result-card fail"><h2>Not saved</h2><p>${esc(error)}</p>
      <button class="btn dark" id="ok" style="width:100%">OK</button></div></div>`;
  } else if (result === "FAIL") {
    host.innerHTML = `<div class="overlay" role="alertdialog" aria-modal="true"><div class="result-card fail">
      <h2>✕ Fail: batch ${esc(batch.batchId)} is ON HOLD</h2>
      <p>Stop production of this batch and keep parts segregated. The quality engineer on shift has been alerted. Only an authorised user can clear the hold.</p>
      <p class="muted small">Logged: ${esc(spec.label)} ${esc(display)} · Terminal ${TERMINAL}${deviationId ? ` · ${esc(deviationId)} opened` : ""}${offline ? " · held locally by the gateway, will sync when online" : ""}</p>
      <button class="btn dark big" id="ok" style="width:100%">I understand</button></div></div>`;
  } else {
    host.innerHTML = `<div class="overlay"><div class="result-card pass">
      <h2>✓ Pass: result saved</h2>
      <p>${esc(spec.label)} ${esc(display)} is within ${esc(limitText(spec))}.</p>
      ${offline ? `<p class="muted small">Stored on the gateway. It will sync to the cloud when the connection returns.</p>` : ""}
      <button class="btn primary big" id="ok" style="width:100%">Next inspection</button></div></div>`;
  }
  host.querySelector("#ok").focus();
  return new Promise((resolve) => host.querySelector("#ok").addEventListener("click", () => { host.innerHTML = ""; resolve(); }));
}

export async function render(el, { user }) {
  await load();

  const paint = () => {
    el.innerHTML = view(user);
    bind();
  };

  const bind = () => {
    el.querySelectorAll("[data-batch]").forEach((b) => b.addEventListener("click", async () => {
      state.batchId = b.dataset.batch; state.value = ""; state.visual = null; state.detail = null;
      if (!gateway.isOffline()) {
        try { state.detail = await api("GET", `/batches/${encodeURIComponent(state.batchId)}`); } catch { /* optional */ }
      }
      paint();
    }));
    el.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => {
      state.type = b.dataset.type; state.value = ""; state.visual = null; paint();
    }));
    el.querySelectorAll("[data-visual]").forEach((b) => b.addEventListener("click", () => {
      state.visual = b.dataset.visual; paint();
    }));
    const input = el.querySelector("#reading");
    if (input) {
      input.addEventListener("input", () => {
        state.value = input.value;
        const spec = current().spec.checks[state.type];
        const ok = state.value !== "" && !Number.isNaN(Number(state.value));
        el.querySelector("#live").innerHTML = ok
          ? (localCheck(spec, state.value) === "PASS" ? `<span class="badge green">Within limit</span>` : `<span class="badge red">Outside limit</span>`)
          : "";
        el.querySelector("#save").disabled = !ok;
      });
    }
    el.querySelector("#simulate")?.addEventListener("click", () => {
      const spec = current().spec.checks[state.type];
      const min = Number(spec.min), max = Number(spec.max), span = max - min;
      // Mostly in spec, about 1 in 5 readings just outside it.
      const v = Math.random() < 0.2 ? max + span * (0.03 + Math.random() * 0.12) : min + span * (0.15 + Math.random() * 0.7);
      const decimals = String(spec.min).split(".")[1]?.length || 1;
      state.value = v.toFixed(decimals);
      paint();
    });
    el.querySelector("#save")?.addEventListener("click", save);
    el.querySelector("#gw").addEventListener("click", toggleGateway);
  };

  async function save() {
    const batch = current();
    const spec = batch.spec.checks[state.type];
    const value = spec.kind === "visual" ? state.visual : state.value;
    const display = spec.kind === "visual" ? value : `${value} ${spec.unit}`;
    const btn = el.querySelector("#save");
    btn.disabled = true; btn.textContent = "Saving...";

    if (gateway.isOffline()) {
      const result = localCheck(spec, value);
      gateway.enqueue({ batchId: batch.batchId, inspectionType: state.type, value, terminal: TERMINAL, label: spec.label, display });
      if (result === "FAIL") { batch.status = "ON_HOLD"; gateway.cacheBatches(state.batches); }
      await showResult(el, { result, batch, spec, display, offline: true });
    } else {
      try {
        const res = await api("POST", `/batches/${encodeURIComponent(batch.batchId)}/readings`,
          { inspectionType: state.type, value, terminal: TERMINAL });
        await showResult(el, { result: res.result, batch, spec, display, deviationId: res.deviationId });
      } catch (err) {
        await showResult(el, { error: err.message });
      }
      await load();
    }
    state.value = ""; state.visual = null;
    paint();
  }

  async function toggleGateway() {
    if (!gateway.isOffline()) {
      gateway.setOffline(true);
      toast("Internet outage simulated: the gateway keeps recording");
      paint();
      return;
    }
    gateway.setOffline(false);
    const pending = gateway.queue().length;
    try {
      const res = await gateway.sync();
      if (pending) toast(`${res.sent} result(s) synced to AWS${res.failed ? `, ${res.failed} rejected` : ""}`);
    } catch (err) {
      toast(`Sync failed: ${err.message}`);
    }
    await load();
    paint();
  }

  paint();
}
