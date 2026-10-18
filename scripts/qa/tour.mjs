// A tour of Lanes in the live bb at 1440×900, light and dark: the pane at 15
// minutes and at an hour, a hovered block, the tooltip, the decision card
// (when something waits), a hovered hand-off line, the menus, a pan back in
// time, a zoom, and the team panel beside a thread. Screenshots go to
// <outDir>/<step>-<scheme>.png.
//
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/tour.mjs [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BB, launch } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity/bb";
mkdirSync(out, { recursive: true });

async function pane(browser, scheme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));
  await page.goto(`${BB}/plugins/lanes/lanes`, { waitUntil: "networkidle" });
  await page.waitForSelector(".bl-track", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  return page;
}

/** The centre of the widest visible element matching `selector`. */
const centreOf = (page, selector) =>
  page.evaluate((selector) => {
    const track = document.querySelector(".bl-track").getBoundingClientRect();
    let best = null;
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      const left = Math.max(r.left, track.left + 40);
      const right = Math.min(r.right, track.right);
      if (right - left < 24 || r.top < track.top || r.bottom > innerHeight - 20) continue;
      if (!best || right - left > best.w) best = { x: (left + right) / 2, y: r.top + r.height / 2, w: right - left };
    }
    return best;
  }, selector);

const shot = (page, step, scheme) => page.screenshot({ path: join(out, `${step}-${scheme}.png`) });
// Park the pointer in the title bar, so nothing in the pane shows hover.
const rest = (page) => page.mouse.move(720, 18);

const browser = await launch();
try {
  for (const scheme of ["light", "dark"]) {
    const page = await pane(browser, scheme);
    await shot(page, "pane", scheme);
    // The last hour shows more of a day's work; the rest of the tour runs on it.
    await page.keyboard.press("2");
    await page.waitForTimeout(1200);
    await rest(page);
    await page.waitForTimeout(300);
    await shot(page, "pane-1h", scheme);

    // Blocks slide with the clock, so aim at the widest one's centre rather than wait for it to settle.
    const block = await centreOf(page, ".bl-block[data-status=done]");
    if (block) {
      await page.mouse.move(block.x, block.y);
      await page.waitForTimeout(300);
      await shot(page, "hover", scheme);
      await page.mouse.click(block.x, block.y);
      await page.waitForSelector(".bl-tip");
      await page.waitForTimeout(900);
      await rest(page);
      await page.waitForTimeout(200);
      await shot(page, "tooltip", scheme);
      await page.keyboard.press("Escape");
    }

    const waiting = await centreOf(page, ".bl-block[data-status=waiting]");
    if (waiting) {
      await page.mouse.click(waiting.x, waiting.y);
      await page.waitForSelector(".bl-ask");
      await page.waitForTimeout(400);
      await shot(page, "decision", scheme);
      await page.keyboard.press("Escape");
    }

    const line = await page.evaluate(() => {
      for (const path of document.querySelectorAll(".bl-curve-hit")) {
        const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
        if (p.x > 0 && p.y > 160 && p.y < 880) return { x: p.x, y: p.y };
      }
      return null;
    });
    if (line) {
      await page.mouse.move(line.x, line.y);
      await page.waitForTimeout(400);
      await shot(page, "line-hover", scheme);
    }

    await page.locator(".lanes-bar button[aria-label^='Group by']").click();
    await page.waitForTimeout(300);
    await shot(page, "group-menu", scheme);
    await page.keyboard.press("Escape");
    await page.locator(".lanes-pill").click();
    await page.waitForTimeout(300);
    await shot(page, "window-menu", scheme);
    await page.keyboard.press("Escape");

    // Pan back in time with a horizontal wheel over the track, then zoom out around the pointer.
    const track = await page.locator(".bl-track").boundingBox();
    await page.mouse.move(track.x + track.width * 0.6, track.y + 120);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(-120, 0);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(700);
    await shot(page, "panned", scheme);
    await page.keyboard.down("Control");
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 60);
      await page.waitForTimeout(16);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(700);
    await shot(page, "zoomed", scheme);

    // The team panel, beside the first lane that has sub-threads.
    const thread = await page.evaluate(() => {
      const cell = [...document.querySelectorAll(".lanes-agent")].find((c) => c.querySelector(".lanes-disclose"));
      return cell?.querySelector("a.lanes-name")?.getAttribute("href") ?? null;
    });
    if (thread) {
      await page.goto(`${BB}${thread}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const show = page.locator("button[aria-label^='Show right panel']");
      if (await show.count()) await show.click();
      await page.locator("button[aria-label^='Open new tab']").click();
      await page.getByText("Team lanes", { exact: true }).first().click();
      await page.waitForSelector(".lanes-tray .bl-track", { timeout: 10000 });
      await page.waitForTimeout(2000);
      await shot(page, "team-panel", scheme);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
