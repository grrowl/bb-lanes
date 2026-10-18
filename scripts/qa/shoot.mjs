// Usage: node shoot.mjs <outPrefix> [path] [width] [height] [scheme]
import { chromium } from "playwright";
const [out, path = "/plugins/lanes/lanes", w = "1440", h = "900", scheme = "dark"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme, deviceScaleFactor: 2 });
const errors = [];
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:38886${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}.png` });
console.log(errors.slice(0, 15).join("\n") || "no console errors");
await browser.close();
