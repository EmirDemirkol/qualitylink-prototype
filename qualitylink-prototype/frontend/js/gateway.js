// Simulates the on-site line gateway (AWS IoT Greengrass in the Part 2 design).
//
// Real design: the gateway caches approved specs, checks readings locally,
// and stores readings during an internet outage (>= 8 hours, QR04), then
// forwards them to the cloud when the connection returns.
//
// Prototype: the browser plays the gateway. The "Online/Offline" switch
// simulates an outage. Specs are cached from the last online load, readings
// are queued in localStorage, and they sync automatically when back online.
import { api } from "./api.js";

const QUEUE = "ql.gateway.queue";
const MODE = "ql.gateway.offline";
const CACHE = "ql.gateway.batches";

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const isOffline = () => read(MODE, false) === true;
export const setOffline = (value) => write(MODE, Boolean(value));
export const queue = () => read(QUEUE, []);
export const cachedBatches = () => read(CACHE, []);
export const cacheBatches = (batches) => write(CACHE, batches);

export function enqueue(reading) {
  const q = queue();
  q.push({ ...reading, offline: true, recordedAt: new Date().toISOString(), localId: crypto.randomUUID() });
  write(QUEUE, q);
}

// Store-and-forward: send queued readings in the order they were taken.
export async function sync() {
  const results = { sent: 0, failed: 0, holds: [] };
  let q = queue();
  while (q.length) {
    const item = q[0];
    try {
      const res = await api("POST", `/batches/${encodeURIComponent(item.batchId)}/readings`, {
        inspectionType: item.inspectionType, value: item.value, offline: true,
        recordedAt: item.recordedAt, terminal: item.terminal,
      });
      results.sent += 1;
      if (res.result === "FAIL") results.holds.push(item.batchId);
    } catch (err) {
      if (!err.status || err.status >= 500) break; // network problem: keep it queued, try later
      results.failed += 1;                         // rejected by the server (e.g. batch released): report it
    }
    q = queue().filter((x) => x.localId !== item.localId);
    write(QUEUE, q);
  }
  return results;
}
