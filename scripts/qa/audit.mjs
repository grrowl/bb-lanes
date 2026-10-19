// Audit real bb interactions with the local build in this browser only.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/audit.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BB, launch } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity/live/audit";
mkdirSync(out, { recursive: true });
const results = [];
const measurements = [];
const browser = await launch();
const keyColumns = (menu) => menu.locator(".lanes-menu-key").evaluateAll((keys) => keys.map((el) => ({
  key: el.textContent, right: el.getBoundingClientRect().right,
})));

async function open(scheme, { preview = true, width = 1440, failHistory = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  if (preview) await page.route("**/api/v1/plugin-app-assets/*/app.*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const js = route.request().url().endsWith("/app.js");
    const lanes = js ? body.includes("Pan back and forth") && body.includes("Window span") : body.includes(".lanes-tray");
    await route.fulfill(lanes ? { response, body: readFileSync(`dist/app.${js ? "js" : "css"}`, "utf8") } : { response });
  });
  if (failHistory) await page.route("**/plugins/agent-lanes/rpc/lanes_window", (route) => route.abort("failed"));
  await page.goto(`${BB}/plugins/agent-lanes/lanes`, { waitUntil: "networkidle" });
  await page.locator(".lanes-tray").waitFor();
  await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), scheme === "dark");
  return page;
}
const settle = (page) => page.waitForFunction(() => !document.querySelector(".bl[data-moving]"));
const focusPill = (page) => page.waitForFunction(() => document.activeElement?.matches(".lanes-bar .lanes-pill"));

try {
  const baseline = await open("dark", { preview: false });
  await baseline.locator(".lanes-bar .lanes-pill").click();
  const before = baseline.getByRole("menu");
  await before.screenshot({ path: join(out, "window-before-dark.png") });
  measurements.push({ version: "installed", keys: await keyColumns(before) });
  await baseline.close();

  for (const scheme of ["light", "dark"]) {
    const page = await open(scheme);
    const pill = page.locator(".lanes-bar .lanes-pill");
    await pill.click();
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitemradio", { name: /15 minutes/ }).waitFor();
    const columns = await keyColumns(menu);
    assert(Math.max(...columns.map((k) => k.right)) - Math.min(...columns.map((k) => k.right)) < 1, "All shortcut hints share one column");
    assert.equal(await menu.getByRole("menuitemradio", { name: /15 minutes/ }).getAttribute("aria-checked"), "true");
    assert.equal(await menu.getByRole("menuitem", { name: /Jump to now/ }).getAttribute("aria-disabled"), "true");
    measurements.push({ version: scheme, keys: columns });
    await menu.screenshot({ path: join(out, `window-${scheme}.png`) });
    await page.keyboard.press("2");
    await focusPill(page);
    await settle(page);
    assert.equal(await pill.textContent(), "Last 1h");
    await page.keyboard.press("[");
    await settle(page);
    assert.match(await pill.getAttribute("aria-label"), /not following the clock/);
    await pill.click();
    await menu.waitFor();
    await page.keyboard.press("n");
    await focusPill(page);
    await settle(page);
    assert.equal(await pill.textContent(), "Last 1h");
    results.push({ name: `${scheme}: aligned hints, selected span, menu shortcuts and return to now`, status: "passed" });

    const active = page.getByRole("radio", { name: "Active", exact: true });
    await active.focus();
    await page.keyboard.press("ArrowRight");
    const needs = page.getByRole("radio", { name: /Needs you/ });
    assert.equal(await needs.getAttribute("aria-checked"), "true");
    assert(await needs.evaluate((el) => document.activeElement === el));
    await page.keyboard.press("/");
    await page.keyboard.type("nothing matches this test");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("searchbox").inputValue(), "");
    await page.keyboard.press("Escape");
    assert(await needs.evaluate((el) => document.activeElement === el));
    await page.keyboard.press("Home");
    assert.equal(await page.getByRole("radio", { name: "All", exact: true }).getAttribute("aria-checked"), "true");
    results.push({ name: `${scheme}: filter keyboard navigation and search focus restoration`, status: "passed" });

    // All includes idle lanes whose blocks can be outside the virtualized
    // rows. Return to Active and widen before inspecting a completed turn.
    await active.click();
    await page.keyboard.press("3");
    await settle(page);
    const turn = page.locator(".bl-block[data-status=done]").first();
    await turn.focus();
    await page.keyboard.press("Enter");
    const tooltip = page.locator(".bl-tip");
    await tooltip.getByText("Turn details", { exact: true }).click();
    await tooltip.getByText("Prompt", { exact: true }).waitFor();
    await tooltip.screenshot({ path: join(out, `detail-${scheme}.png`) });
    await page.keyboard.press("Escape");
    assert(await turn.evaluate((el) => document.activeElement === el));
    results.push({ name: `${scheme}: prompt disclosure and Escape focus restoration`, status: "passed" });
    await page.close();
  }

  const mobile = await open("dark", { width: 390 });
  await mobile.getByRole("button", { name: "View options" }).click();
  await mobile.getByRole("menuitemradio", { name: /^Project/ }).waitFor();
  await mobile.evaluate(() => {
    window.__lanesAuditMotion = { samples: [], done: false };
    const start = performance.now();
    const sample = (now) => {
      const root = document.querySelector(".bl[data-reflow]");
      if (root) for (const caption of root.querySelectorAll(".bl-caption")) {
        const title = caption.querySelector(".bl-caption-title")?.textContent;
        const names = [...root.querySelectorAll(".bl-name[data-kind=lane]")].filter((name) => name.querySelector("a")?.title === title);
        if (names.length !== 1) continue;
        const y = (el) => new DOMMatrix(getComputedStyle(el).transform).m42;
        window.__lanesAuditMotion.samples.push(Math.abs(y(names[0]) - y(caption)));
      }
      if (now - start < 900) requestAnimationFrame(sample);
      else window.__lanesAuditMotion.done = true;
    };
    requestAnimationFrame(sample);
  });
  await mobile.getByRole("menuitemradio", { name: /^None/ }).click();
  await mobile.waitForFunction(() => window.__lanesAuditMotion.done);
  const motion = await mobile.evaluate(() => window.__lanesAuditMotion.samples);
  assert(motion.length > 0, "Sampled rows during their reflow");
  assert(Math.max(...motion) < 1, "Captions move with their lane names on every sampled frame");
  measurements.push({ version: "mobile", captionMotionDifferences: motion });
  await mobile.waitForFunction(() => !document.querySelector(".bl[data-reflow]"));
  await mobile.getByRole("button", { name: "View options" }).click();
  assert.equal(await mobile.getByRole("menuitemradio", { name: /^None/ }).getAttribute("aria-checked"), "true");
  await mobile.screenshot({ path: join(out, "mobile-dark.png") });
  results.push({ name: "mobile: group selection, selected state and synchronized caption motion", status: "passed" });
  await mobile.close();

  const failure = await open("dark", { failHistory: true });
  await failure.getByText("History unavailable", { exact: true }).first().waitFor();
  assert.equal(await failure.getByText(/No agent activity/).count(), 0);
  await failure.screenshot({ path: join(out, "history-error-dark.png") });
  results.push({ name: "history request failure is visible and does not claim there is no activity", status: "passed" });
  await failure.close();
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(out, "measurements.json"), JSON.stringify(measurements, null, 2));
  await browser.close();
}
