// Check pane shortcuts against real bb data, optionally previewing dist/ in
// this browser only without changing the installed plugin.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools QA_LOCAL_BUILD=1 node scripts/qa/shortcuts.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BB, launch } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity/live/shortcuts";
mkdirSync(out, { recursive: true });
const results = [];
const browser = await launch();
try {
  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    let previewed = false;
    if (process.env.QA_LOCAL_BUILD === "1") {
      await page.route("**/api/v1/plugin-app-assets/*/app.*", async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        const js = route.request().url().endsWith("/app.js");
        const lanes = js ? body.includes("Pan back and forth") && body.includes("Window span") : body.includes(".lanes-tray");
        if (lanes) {
          previewed ||= js;
          await route.fulfill({ response, body: readFileSync(`dist/app.${js ? "js" : "css"}`, "utf8") });
        } else await route.fulfill({ response });
      });
    }
    await page.goto(`${BB}/plugins/agent-lanes/lanes`, { waitUntil: "networkidle" });
    await page.locator(".lanes-tray").waitFor();
    if (process.env.QA_LOCAL_BUILD === "1") assert(previewed, "Loaded the local build");
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), scheme === "dark");
    const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
    const windowPill = page.locator(".lanes-bar .lanes-pill");
    const label = async () => windowPill.getAttribute("aria-label");
    const settle = () => page.waitForFunction(() => !document.querySelector(".bl[data-moving]"));
    const key = async (key) => { await page.keyboard.press(key); await settle(); };

    await help.click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("menuitem").count(), 0);
    await dialog.screenshot({ path: join(out, `help-${scheme}.png`) });
    await key("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Keyboard shortcuts");
    assert(await help.evaluate((el) => el === document.activeElement), "Esc restores the help button");
    await key("2");
    assert.equal(await label(), "Window: Last 1h");
    await key("[");
    assert.match(await label(), /not following the clock/);
    await key("]");
    assert.equal(await label(), "Window: Last 1h");
    await key("[");
    await key("n");
    assert.equal(await label(), "Window: Last 1h");
    await key("=");
    await page.waitForFunction(() => document.querySelector(".lanes-bar .lanes-pill")?.textContent === "Last 30m");
    await key("-");
    await page.waitForFunction(() => document.querySelector(".lanes-bar .lanes-pill")?.textContent === "Last 1h");
    results.push({ name: `${scheme}: pan, zoom, presets and now after closing help`, status: "passed" });

    await key("Shift+G");
    await page.getByRole("menu").waitFor();
    await key("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.matches(".lanes-bar button[aria-label^='Group by']"));
    await key("/");
    const search = page.getByRole("searchbox");
    assert(await search.evaluate((el) => el === document.activeElement));
    await page.keyboard.type("1[n-g=");
    assert.equal(await search.inputValue(), "1[n-g=");
    assert.equal(await label(), "Window: Last 1h");
    await key("Escape");
    await key("Escape");
    results.push({ name: `${scheme}: group and search shortcuts; typing stays in search`, status: "passed" });

    const first = page.locator(".bl-item[data-nav]").first();
    await first.focus();
    await key("ArrowDown");
    assert(await page.locator(".bl-item[data-nav]:focus").count() > 0);
    await page.screenshot({ path: join(out, `pane-${scheme}.png`) });
    results.push({ name: `${scheme}: focused turns retain arrow navigation`, status: "passed" });
    await page.close();
  }
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
