// Sign-in screen with one-click demo accounts for the examiner.
import { signIn } from "../auth.js";
import { CONFIG } from "../config.js";
import { esc, logo, HOME } from "../ui.js";

const DEMO_PASSWORD = "Nuvola-Demo-2026";
const DEMO_USERS = [
  ["operator.kelly", "S. Kelly", "Line operator"],
  ["engineer.murphy", "A. Murphy", "Quality engineer"],
  ["qa.walsh", "C. Walsh", "QA approver"],
  ["client.larsen", "M. Larsen", "Halden Pharma (client)"],
];

export async function render(el) {
  const notDeployed = !CONFIG.apiUrl;
  el.innerHTML = `
    <div class="login-wrap">
      <section class="login-side">
        <div class="brand" style="padding:0">${logo}<span>QualityLink</span></div>
        <h1>Inspection to release, in one traceable record.</h1>
        <p>Prototype for Meridian Medical Components, built on AWS (Ireland).</p>
        <ul>
          <li>Line terminal records results and checks them against the approved spec</li>
          <li>A failed result holds the batch and opens a deviation automatically</li>
          <li>QA releases with an electronic signature (21 CFR Part 11 style)</li>
          <li>Halden Pharma sees only its own batches and certificates</li>
        </ul>
      </section>
      <section class="login-form">
        <div class="card">
          <h2>Sign in</h2>
          ${notDeployed ? `<div class="notice amber" style="margin:12px 0">Not connected to AWS yet. Run <code>scripts/deploy.sh</code> to generate the config.</div>` : ""}
          <form id="login" style="margin-top:14px">
            <div class="field"><label for="u">Username</label><input type="text" id="u" autocomplete="username" required></div>
            <div class="field"><label for="p">Password</label><input type="password" id="p" autocomplete="current-password" required></div>
            <p id="err" class="error-text" role="alert"></p>
            <button class="btn primary" style="width:100%" type="submit">Sign in</button>
          </form>
          <div style="margin-top:20px">
            <strong class="small">Demo accounts (sample data only)</strong>
            <div class="demo-users">
              ${DEMO_USERS.map(([u, n, r]) => `<button type="button" data-user="${u}"><strong>${esc(r)}</strong><span>${esc(n)} · ${u}</span></button>`).join("")}
            </div>
            <p class="legend">All demo accounts use the password <code>${DEMO_PASSWORD}</code>. In production, staff would sign in with company SSO + MFA (Part 2).</p>
          </div>
        </div>
      </section>
    </div>`;

  const form = el.querySelector("#login");
  el.querySelectorAll("[data-user]").forEach((b) => b.addEventListener("click", () => {
    form.u.value = b.dataset.user;
    form.p.value = DEMO_PASSWORD;
    form.requestSubmit();
  }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Signing in...";
    try {
      const user = await signIn(form.u.value, form.p.value);
      location.hash = HOME[user.role] || "#/login";
    } catch (err) {
      el.querySelector("#err").textContent = err.message;
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });
}
