// Exercise actual bb navigation without changing the installed plugin.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/thread-opening.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BB, launch } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity/live/thread-opening";
mkdirSync(out, { recursive: true });
const results = [];
const browser = await launch();
try {
  for (const openBeside of [true, false]) {
    for (const alternate of [false, true]) {
      for (const action of ["header", "popover"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(20_000);
        await page.route("**/api/v1/plugin-app-assets/*/app.*", async (route) => {
          const response = await route.fetch();
          const body = await response.text();
          const js = route.request().url().endsWith("/app.js");
          const lanes = js ? body.includes("Pan back and forth") && body.includes("Window span") : body.includes(".lanes-tray");
          await route.fulfill({ response, body: lanes ? readFileSync(`dist/app.${js ? "js" : "css"}`, "utf8") : body });
        });
        await page.goto(`${BB}/plugins/agent-lanes/lanes`, { waitUntil: "networkidle" });
        const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
        await help.click();
        const preference = page.getByRole("checkbox", { name: "Open to the side by default" });
        if ((await preference.getAttribute("aria-checked") === "true") !== openBeside) await preference.click();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).waitFor({ state: "detached" });
        const modified = alternate ? ["Meta"] : [];
        if (action === "header") {
          await page.locator(".lanes-name").first().click({ modifiers: modified });
        } else {
          await page.locator(".bl-block[data-nav]").first().focus();
          await page.keyboard.press("Enter");
          const open = page.locator(".bl-pop").getByRole("button", { name: "Open", exact: true });
          await open.focus();
          await page.keyboard.press(alternate ? "Control+Enter" : "Enter");
        }
        await page.waitForURL(/\/threads\//);
        const split = openBeside !== alternate;
        const lanes = page.locator(".lanes-tray");
        await lanes.waitFor({ state: split ? "visible" : "detached" });
        assert.equal(await lanes.count() > 0, split);
        results.push({ name: `${action}: default ${openBeside ? "side" : "here"}, ${alternate ? "modifier" : "plain"} opens ${split ? "side" : "here"}`, status: "passed" });
        await page.screenshot({ path: join(out, `${action}-${openBeside}-${alternate}.png`) });
        await page.close();
      }
    }
  }
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
