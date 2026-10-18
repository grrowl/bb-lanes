// Screenshots of the timeline harness, for design review.
//
//   npx vite --config app/timeline/harness/vite.config.ts      # in one shell
//   PLAYWRIGHT_DIR=/path/with/node_modules/playwright-core node app/timeline/harness/shoot.mjs [name…]
//
// PLAYWRIGHT_DIR points at any directory whose node_modules has playwright-core
// (it is not a dependency of the plugin). CHROME may name a Chromium binary.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(process.env.PLAYWRIGHT_DIR ?? here, "noop.js"));
const { chromium } = require("playwright-core");

const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = join(here, "screenshots");

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const build = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return join(cache, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
}

const blockByTitle = (page, title) => page.locator(".bl-block", { hasText: title }).first();

/** name → { query, viewport, act } */
const SHOTS = {
  "light-1440": { query: "elapsed=2&speed=0" },
  "dark-1440": { query: "theme=dark&elapsed=2&speed=0" },
  "narrow-480": { query: "elapsed=2&speed=0", viewport: { width: 480, height: 900 } },
  "narrow-480-dark": { query: "theme=dark&elapsed=2&speed=0", viewport: { width: 480, height: 900 } },
  "tooltip-light": {
    query: "elapsed=2&speed=0",
    async act(page) {
      await blockByTitle(page, "Merge the backend and brief the shell").click();
      await page.waitForTimeout(700);
    },
  },
  "tooltip-dark": {
    query: "theme=dark&elapsed=2&speed=0",
    async act(page) {
      await blockByTitle(page, "Build the timeline engine").click();
      await page.waitForTimeout(700);
    },
  },
  "decision-light": {
    query: "elapsed=2&speed=0",
    async act(page) {
      await blockByTitle(page, "Rotate the API keys").click();
      await page.waitForTimeout(400);
    },
  },
  "decision-dark": {
    query: "theme=dark&elapsed=2&speed=0",
    async act(page) {
      await blockByTitle(page, "Push the shell to main").click();
      await page.waitForTimeout(400);
    },
  },
  "hover-linking": {
    query: "elapsed=2&speed=0&span=1h",
    async act(page) {
      await blockByTitle(page, "Write the spec and contracts").hover();
      await page.waitForTimeout(400);
    },
  },
  "history-pan": {
    query: "elapsed=2&speed=0",
    async act(page) {
      const track = page.locator(".bl-track");
      const box = await track.boundingBox();
      const y = box.y + 14;
      await page.mouse.move(box.x + box.width * 0.7, y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + box.width * 0.7 + i * 30, y);
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.mouse.move(box.x + box.width * 0.42, box.y - 12);
      await page.waitForTimeout(250);
    },
  },
  "span-4h": { query: "elapsed=2&speed=0&span=4h" },
  "span-1d": { query: "elapsed=2&speed=0&span=1d" },
  "span-7d-dark": { query: "theme=dark&elapsed=2&speed=0&span=7d" },
  "collapsed-group": { query: "elapsed=2&speed=0&collapse=project:chillidonut&span=1h" },
  compact: { query: "elapsed=2&speed=0&density=compact" },
  "paper-light": { query: "palette=paper&elapsed=2&speed=0" },
  "paper-dark": { query: "palette=paper&theme=dark&elapsed=2&speed=0" },
  "stress-200": { query: "scenario=stress&speed=0&span=4h" },
  "stress-200-7d": { query: "scenario=stress&speed=0&span=7d&theme=dark" },
  empty: { query: "empty=1&speed=0" },
  "empty-dark": { query: "empty=1&speed=0&theme=dark" },
};

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: chromePath() });
try {
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only.length > 0 && !only.includes(name)) continue;
    const page = await browser.newPage({ viewport: shot.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
    await page.goto(`${BASE}?${shot.query ?? ""}`);
    await page.waitForSelector(".bl");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    if (shot.act) await shot.act(page);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`wrote ${name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
