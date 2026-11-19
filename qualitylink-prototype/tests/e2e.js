// Browser walkthrough of the demo story against the local server.
// node tests/e2e.js [outDir]
const { chromium } = require("playwright");
const OUT = process.argv[2] || "shots";
const BASE = "http://localhost:8765";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  const login = async (user) => {
    await page.goto(BASE + "/#/login");
    await page.click(`[data-user="${user}"]`);
    await page.waitForTimeout(700);
  };
  const logout = async () => { await page.click("[data-action=signout]"); await page.waitForTimeout(300); };

  await page.goto(BASE + "/#/login"); await page.waitForTimeout(400); await shot("01-login");

  // Operator: pass reading, then a failing one
  await login("operator.kelly"); await shot("02-terminal");
  await page.click('[data-type="force"]');
  await page.fill("#reading", "6.4"); await page.waitForTimeout(150); await shot("03-terminal-within");
  await page.click("#save"); await page.waitForTimeout(600); await shot("04-pass");
  await page.click("#ok"); await page.waitForTimeout(500);
  // offline: record dimensional while offline
  await page.click("#gw"); await page.waitForTimeout(300);
  await page.click('[data-type="dimensional"]');
  await page.fill("#reading", "5.02"); await page.click("#save"); await page.waitForTimeout(300);
  await page.click("#ok"); await page.waitForTimeout(300); await shot("05-offline-queue");
  await page.click("#gw"); await page.waitForTimeout(1200); await shot("06-synced");
  // B-24121 now READY. Pick it again and record a failure on force
  await page.click('[data-type="force"]');
  await page.fill("#reading", "9.3"); await page.click("#save"); await page.waitForTimeout(700); await shot("07-fail-hold");
  await page.click("#ok"); await page.waitForTimeout(500); await shot("08-terminal-after-hold");
  await logout();

  // Engineer: batch list, batch detail, deviation DEV-0412
  await login("engineer.murphy"); await shot("09-batches");
  await page.goto(BASE + "/#/batches/B-24117"); await page.waitForTimeout(600); await shot("10-batch-detail");
  await page.goto(BASE + "/#/deviations/B-24117/DEV-0412"); await page.waitForTimeout(600); await shot("11-deviation-open");
  await page.fill("#reason", "Starting investigation"); await page.click('[data-act="start"]'); await page.waitForTimeout(700);
  await page.fill("#inv", "Re-measured 5 retained caps: 19.2-19.9 N. Gauge G-07 checked against reference weight.");
  await page.fill("#rc", "Gauge G-07 drifted out of calibration. Batch parts conform on a calibrated gauge.");
  await page.selectOption("#outcome", "ACCEPT"); await page.fill("#reason", "Investigation complete");
  await page.click('[data-act="close"]'); await page.waitForTimeout(800); await shot("12-deviation-closed");
  await page.goto(BASE + "/#/deviations"); await page.waitForTimeout(500); await shot("13-deviations");
  await logout();

  // QA: release queue, wrong password, then sign
  await login("qa.walsh"); await page.goto(BASE + "/#/release/B-24117"); await page.waitForTimeout(700); await shot("14-release");
  await page.fill("#pw", "wrong"); await page.click("#sign button[type=submit]"); await page.waitForTimeout(700); await shot("15-wrong-pw");
  await page.fill("#pw", "Nuvola-Demo-2026"); await page.click("#sign button[type=submit]"); await page.waitForTimeout(900); await shot("16-released");
  await page.goto(BASE + "/#/release/B-24121"); await page.waitForTimeout(700); await shot("17-blocked");
  await page.goto(BASE + "/#/audit?batch=B-24117"); await page.waitForTimeout(600); await shot("18-audit");
  await logout();

  // Client
  await login("client.larsen"); await shot("19-portal");
  await page.goto(BASE + "/#/certificate/B-24117"); await page.waitForTimeout(700); await shot("20-certificate");
  // try to open internal record: should bounce back to portal
  await page.goto(BASE + "/#/batches/B-24117"); await page.waitForTimeout(500);
  console.log("client internal route ->", page.url());
  await logout();

  // Mobile check
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => errors.push("m pageerror: " + e.message));
  await mp.goto(BASE + "/#/login"); await mp.click('[data-user="operator.kelly"]'); await mp.waitForTimeout(800);
  await mp.screenshot({ path: `${OUT}/21-mobile-terminal.png`, fullPage: true });
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  console.log("mobile scrollWidth", sw);

  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
})();
