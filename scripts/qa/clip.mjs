// A clipped region of a live bb page.
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/clip.mjs <out> <x> <y> <w> <h> [path] [scheme]
import { BB, launch } from "./browser.mjs";

const [out, x, y, w, h, path = "/plugins/agent-lanes/lanes", scheme = "dark"] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
  await page.goto(`${BB}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } });
} finally {
  await browser.close();
}
