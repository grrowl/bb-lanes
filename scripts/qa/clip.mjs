// Usage: node clip.mjs <out> <x> <y> <w> <h> [path] [scheme]
import { chromium } from "playwright";
const [out, x, y, w, h, path = "/plugins/lanes/lanes", scheme = "dark"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:38886${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } });
await browser.close();
