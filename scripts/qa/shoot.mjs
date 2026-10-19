// A screenshot of a live bb page, with its console errors.
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/shoot.mjs <outPrefix> [path] [width] [height] [scheme]
import { BB, launch } from "./browser.mjs";

const [out, path = "/plugins/agent-lanes/lanes", w = "1440", h = "900", scheme = "dark"] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme, deviceScaleFactor: 2 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BB}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}.png` });
  console.log(errors.slice(0, 15).join("\n") || "no console errors");
} finally {
  await browser.close();
}
