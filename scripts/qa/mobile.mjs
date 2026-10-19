// Lanes on a phone, in the live bb: screenshots at 390×844 in both themes,
// and touch drags that check bb's swipe-to-open sidebar leaves the time axis
// alone while a swipe from the avatars still opens it.
//
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/mobile.mjs <outDir>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BB, launch } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity/live/mobile";
mkdirSync(out, { recursive: true });

async function phone(browser, scheme) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));
  await page.goto(`${BB}/plugins/lanes/lanes`, { waitUntil: "networkidle" });
  await page.waitForSelector(".bl-track", { timeout: 15000 });
  await page.waitForTimeout(2000);
  return { context, page, cdp: await context.newCDPSession(page) };
}

async function drag(cdp, from, to, steps = 12) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** bb's mobile sidebar is open while its backdrop is. */
const sidebarOpen = (page) => page.evaluate(() => document.querySelector('[data-sidebar-mobile-backdrop][data-state="open"]') !== null);

const checks = [];
const browser = await launch();
try {
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await phone(browser, scheme);
    await page.screenshot({ path: join(out, `lanes-390-${scheme}.png`) });
    await context.close();
  }

  // A rightward drag over the track pans back in time and leaves the sidebar shut.
  {
    const { context, page, cdp } = await phone(browser, "light");
    const track = await page.locator(".bl-track").boundingBox();
    const y = track.y + 120;
    await drag(cdp, { x: track.x + 60, y }, { x: track.x + 260, y });
    await page.waitForTimeout(700);
    const live = await page.evaluate(() => document.querySelector(".bl")?.hasAttribute("data-live"));
    checks.push(["Rightward drag on the track pans back in time", live === false]);
    checks.push(["…and does not open bb's sidebar", (await sidebarOpen(page)) === false]);
    await page.screenshot({ path: join(out, "lanes-390-panned.png") });

    await context.close();
  }

  // A vertical swipe over the track scrolls the rows natively. Every lane
  // shows (filter All) so there is something to scroll.
  {
    const { context, page } = await phone(browser, "light");
    // Preferences are keyed by plugin id and surface; this plugin's id is "lanes".
    await page.evaluate(() => localStorage.setItem("lanes:lanes:preferences", JSON.stringify({ filter: "all" })));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".bl-track");
    await page.waitForTimeout(1500);
    const cdp = await context.newCDPSession(page);
    const track = await page.locator(".bl-track").boundingBox();
    const scrollTop = () => page.evaluate(() => document.querySelector(".bl-scroller")?.scrollTop ?? 0);
    const before = await scrollTop();
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(track.x + 160),
      y: 600,
      yDistance: -300,
      gestureSourceType: "touch",
    });
    await page.waitForTimeout(700);
    const after = await scrollTop();
    const rows = await page.locator(".bl-name").count();
    checks.push([`Vertical swipe over the track scrolls the rows (${rows} rows, scrollTop ${before} → ${after})`, after > before]);
    const live = await page.evaluate(() => document.querySelector(".bl")?.hasAttribute("data-live"));
    checks.push(["…and leaves the window following the clock", live === true]);
    await context.close();
  }

  // A rightward drag starting over the avatars still opens bb's sidebar.
  {
    const { context, page, cdp } = await phone(browser, "light");
    const names = await page.locator(".bl-name[data-kind='lane']").first().boundingBox();
    const y = names.y + names.height / 2;
    await drag(cdp, { x: Math.max(30, names.x + 18), y }, { x: 330, y }, 16);
    await page.waitForTimeout(800);
    checks.push(["Rightward drag from the avatars opens bb's sidebar", await sidebarOpen(page)]);
    await page.screenshot({ path: join(out, "lanes-390-sidebar.png") });
    await context.close();
  }
} finally {
  await browser.close();
}
for (const [what, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
