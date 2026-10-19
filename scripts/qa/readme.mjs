// The README's screenshots. They come from the harness, which draws the real
// engine and shell chrome around made-up threads, so no private thread data
// ever reaches the repo. Run the harness first:
//   npx vite --config app/timeline/harness/vite.config.ts
//   PLAYWRIGHT_DIR=<dir with playwright-core> node scripts/qa/readme.mjs [outDir]
import { mkdirSync } from "node:fs";
import { HARNESS, launch, open } from "./browser.mjs";

const out = process.argv[2] ?? "docs/screenshots";
mkdirSync(out, { recursive: true });
const browser = await launch();
const frozen = "chrome=0&elapsed=6&speed=0";

async function shot(name, query, { width = 1440, height = 820, scheme = "light", act } = {}) {
  const page = await open(browser, `${HARNESS}?${frozen}&${query}${scheme === "dark" ? "&theme=dark" : ""}`, {
    width,
    height,
    scheme,
  });
  await page.waitForSelector(".bl-block");
  await page.waitForTimeout(400);
  if (act) await act(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log(`${out}/${name}.png`);
}

// Blocks slide with the clock in live mode, so click them through the DOM.
const click = (page, name) =>
  page.getByRole("button", { name }).first().evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

for (const scheme of ["light", "dark"]) {
  await shot(`lanes-${scheme}`, "span=15m", { scheme });
  await shot(`tooltip-${scheme}`, "span=15m", {
    scheme,
    act: async (page) => {
      await click(page, /Draft the pricing page/);
      await page.waitForTimeout(700);
    },
  });
  await shot(`decision-${scheme}`, "span=15m", {
    scheme,
    act: async (page) => {
      await click(page, /Rotate the API keys/);
      await page.waitForTimeout(500);
    },
  });
  await shot(`phone-${scheme}`, "span=15m", { scheme, width: 390, height: 844 });
}
await browser.close();
