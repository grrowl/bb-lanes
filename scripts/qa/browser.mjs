// Shared by the QA scripts: Playwright driving the installed Chrome.
// playwright-core is not a dependency of the plugin; point PLAYWRIGHT_DIR at
// any directory whose node_modules has it (e.g. `npm i playwright-core` in
// /tmp/lanes-qa-tools), or install it next to the repo.
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const UPSTREAM = process.env.UPSTREAM_URL ?? "http://localhost:5181/";
export const HARNESS = process.env.HARNESS_URL ?? "http://localhost:5199/";
export const BB = process.env.BB_URL ?? "http://127.0.0.1:38886";

export function launch() {
  return chromium.launch({ executablePath: CHROME });
}

/** A page at 2x with errors echoed, ready once fonts have loaded. */
export async function open(browser, url, { width = 1100, height = 560, scheme = "light" } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error(`[page error] ${url}: ${error.message}`));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Lay two screenshots side by side, labelled, into one PNG. */
export async function sideBySide(browser, out, panels, { dark = false } = {}) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const cells = panels
    .map(
      ({ label, png }) =>
        `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${png.toString("base64")}"></figure>`,
    )
    .join("");
  await page.setContent(`<style>
    body{margin:0;display:inline-flex;align-items:flex-start;gap:16px;padding:16px;background:${dark ? "#000" : "#e9e9ec"};font:600 22px/1.2 system-ui;color:${dark ? "#bbb" : "#444"}}
    figure{margin:0}figcaption{padding:4px 4px 10px}img{display:block;width:auto;border-radius:8px}
  </style>${cells}`);
  // Measure only once every image has decoded, or the capture repeats its top.
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const size = await page.evaluate(() => {
    const box = document.body.getBoundingClientRect();
    return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
  });
  await page.setViewportSize(size);
  await page.screenshot({ path: out });
  await page.close();
}
