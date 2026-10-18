// A screenshot of any URL, with its page errors.
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/url.mjs <out> <url> [width] [height] [scheme]
import { launch } from "./browser.mjs";

const [out, url, w = "1100", h = "560", scheme = "light"] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  console.log(errors.join("\n") || "ok");
} finally {
  await browser.close();
}
