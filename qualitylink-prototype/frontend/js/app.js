// QualityLink single-page app: a tiny hash router plus the three layouts
// (line terminal, staff with sidebar, client portal).
import { currentUser, signOut } from "./auth.js";
import { esc, logo, protoBanner, spinner, errorCard, HOME } from "./ui.js";
import * as loginView from "./views/login.js";
import * as terminalView from "./views/terminal.js";
import * as batchesView from "./views/batches.js";
import * as deviationsView from "./views/deviations.js";
import * as releaseView from "./views/release.js";
import * as auditView from "./views/audit.js";
import * as portalView from "./views/portal.js";

const ROLE_LABEL = { operator: "Operator", engineer: "Quality engineer", qa: "QA approver", client: "Client" };

// Which screens each role may open. The API enforces the same rules again,
// so hiding a screen here is for usability, not security.
const ROUTES = [
  { re: /^#\/login$/, view: loginView.render, layout: "none", public: true },
  { re: /^#\/terminal$/, view: terminalView.render, layout: "none", roles: ["operator"] },
  { re: /^#\/release(?:\/([^/]+))?$/, view: releaseView.render, layout: "staff", nav: "release", roles: ["qa"] },
  { re: /^#\/batches$/, view: batchesView.renderList, layout: "staff", nav: "batches", roles: ["engineer", "qa"] },
  { re: /^#\/batches\/([^/]+)$/, view: batchesView.renderDetail, layout: "staff", nav: "batches", roles: ["engineer", "qa"] },
  { re: /^#\/deviations$/, view: deviationsView.renderList, layout: "staff", nav: "deviations", roles: ["engineer", "qa"] },
  { re: /^#\/deviations\/([^/]+)\/([^/]+)$/, view: deviationsView.renderDetail, layout: "staff", nav: "deviations", roles: ["engineer", "qa"] },
  { re: /^#\/audit$/, view: auditView.render, layout: "staff", nav: "audit", roles: ["engineer", "qa"] },
  { re: /^#\/portal$/, view: portalView.renderPortal, layout: "portal", roles: ["client"] },
  { re: /^#\/certificate\/([^/]+)$/, view: portalView.renderCertificate, layout: "auto", nav: "release", roles: ["client", "qa", "engineer"] },
];

const NAV = {
  engineer: [["batches", "#/batches", "Batches"], ["deviations", "#/deviations", "Deviations"], ["audit", "#/audit", "Audit trail"]],
  qa: [["release", "#/release", "Release queue"], ["batches", "#/batches", "Batches"], ["deviations", "#/deviations", "Deviations"], ["audit", "#/audit", "Audit trail"]],
};

function staffLayout(user, active) {
  const links = (NAV[user.role] || [])
    .map(([key, href, label]) => `<a href="${href}" class="${key === active ? "active" : ""}">${label}</a>`)
    .join("");
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">${logo}<span>QualityLink</span></div>
        <nav class="nav" aria-label="Main">${links}</nav>
        <div class="who"><strong>${esc(user.name)}</strong>${ROLE_LABEL[user.role]}
          <br><button data-action="signout">Sign out</button></div>
      </aside>
      <main class="main" id="view">${spinner}</main>
    </div>${protoBanner}`;
}

function portalLayout(user) {
  return `
    <header class="portal-top no-print">
      ${logo}<strong>Meridian Client Portal</strong><span class="badge grey">Powered by QualityLink</span>
      <span class="right">${esc(user.name)} · ${esc(user.organisation || "")} · <a href="#" data-action="signout">Sign out</a></span>
    </header>
    <main class="portal-main" id="view">${spinner}</main>${protoBanner}`;
}

async function route() {
  const [path, query] = (location.hash || "#/login").split("?");
  const params = new URLSearchParams(query || "");
  const user = currentUser();
  const match = ROUTES.find((r) => r.re.test(path));

  if (!match) { location.hash = user ? HOME[user.role] : "#/login"; return; }
  if (!match.public && !user) { location.hash = "#/login"; return; }
  if (match.public && user) { location.hash = HOME[user.role]; return; }
  if (match.roles && !match.roles.includes(user.role)) { location.hash = HOME[user.role]; return; }

  const args = path.match(match.re).slice(1).map((a) => (a ? decodeURIComponent(a) : a));
  const app = document.getElementById("app");
  let layout = match.layout;
  if (layout === "auto") layout = user.role === "client" ? "portal" : "staff";

  let el;
  if (layout === "staff") { app.innerHTML = staffLayout(user, user.role === "engineer" && match.nav === "release" ? "batches" : match.nav); el = document.getElementById("view"); }
  else if (layout === "portal") { app.innerHTML = portalLayout(user); el = document.getElementById("view"); }
  else { app.innerHTML = `<div id="view">${spinner}</div>`; el = document.getElementById("view"); }

  try {
    await match.view(el, { user, args, params, rerender: route });
  } catch (err) {
    console.error(err);
    el.innerHTML = errorCard(err);
  }
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=signout]")) {
    e.preventDefault();
    signOut();
    location.hash = "#/login";
  }
});

window.addEventListener("hashchange", route);
route();
