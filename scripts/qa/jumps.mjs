// The lane jumpers, checked and photographed: at rest, hovered, and landing,
// in light and dark, on a desktop and on a 390px touch screen, plus a zip
// recorded frame by frame. The recording samples, on every animation frame,
// the moving layer, the ruler's ticks and the target block, so it shows the
// glide is smooth and that ruler, blocks and lines move as one.
//
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/jumps.mjs <harness|bb> [outDir]
//
// `harness` needs `npx vite --config app/timeline/harness/vite.config.ts`;
// `bb` needs the plugin installed in the bb at BB_URL.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BB, HARNESS, launch, sideBySide } from "./browser.mjs";

const target = process.argv[2] === "bb" ? "bb" : "harness";
const out = process.argv[3] ?? target === "bb" ? "docs/fidelity/live/jumps" : "docs/fidelity/jumps/harness";
mkdirSync(out, { recursive: true });

// The harness draws its own theme from `theme`; bb follows the colour scheme.
const placeOf = (scheme) => (target === "bb" ? `${BB}/plugins/lanes/lanes` : `${HARNESS}?elapsed=6&speed=1&chrome=0&theme=${scheme}`);

async function open(browser, { scheme, phone }) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));
  if (target === "bb") {
    // Every lane, so lanes without a turn in the window show their jumpers.
    await page.addInitScript(() => localStorage.setItem("lanes:lanes:preferences", JSON.stringify({ filter: "all" })));
  }
  await page.goto(placeOf(scheme), { waitUntil: "networkidle" });
  await page.waitForSelector(".bl-track", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  return { context, page };
}

/** The first previous-turn jumper fully in view. */
const jumperBox = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll(".bl-jumper[data-show][data-side=prev]")) {
      const face = el.querySelector(".bl-jumper-face").getBoundingClientRect();
      if (face.top > 160 && face.bottom < innerHeight - 40) {
        return { x: face.x + face.width / 2, y: face.y + face.height / 2, label: el.getAttribute("aria-label") };
      }
    }
    return null;
  });

const clipAround = (page, y, height = 260) => {
  const vp = page.viewportSize();
  const top = Math.max(0, Math.min(vp.height - height, y - height / 2));
  return { x: 0, y: top, width: vp.width, height };
};

const results = [];
const browser = await launch();
try {
  for (const phone of [false, true]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${phone ? "390" : "desktop"}-${scheme}`;
      const { context, page } = await open(browser, { scheme, phone });
      const jumper = await jumperBox(page);
      if (!jumper) {
        results.push([`${tag}: a lane shows a previous-turn jumper`, false]);
        await context.close();
        continue;
      }
      results.push([`${tag}: ${jumper.label}`, true]);
      await page.screenshot({ path: join(out, `rest-${tag}.png`) });
      if (!phone) {
        await page.mouse.move(jumper.x, jumper.y);
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(out, `hover-${tag}.png`), clip: clipAround(page, jumper.y) });
      }

      // The zip: sample every animation frame from the click until well after landing.
      await page.evaluate(() => {
        const samples = [];
        window.__zip = samples;
        const layer = document.querySelector(".bl-layer");
        const ticks = document.querySelector(".bl-ticks");
        const tick = (t) => {
          const focused = document.activeElement?.closest?.(".bl-item");
          samples.push({
            t,
            layer: layer.style.transform,
            ticks: document.querySelector(".bl-ticks")?.style.transform ?? ticks.style.transform,
            moving: document.querySelector(".bl").hasAttribute("data-moving"),
            landed: document.querySelector("[data-landed]") !== null,
            focused: focused?.getAttribute("aria-label") ?? null,
          });
          if (samples.length < 90) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const cdp = await context.newCDPSession(page);
      const frames = [];
      if (!phone) {
        cdp.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
          frames.push({ t: metadata.timestamp, png: Buffer.from(data, "base64") });
          await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
        });
        await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
      }
      if (phone) await page.touchscreen.tap(jumper.x, jumper.y);
      else await page.mouse.click(jumper.x, jumper.y);
      // A turn older than the loaded history lands once the shell has loaded it.
      const landed = await page.waitForSelector("[data-landed]", { timeout: 4000 }).catch(() => null);
      if (!phone) await page.mouse.move(jumper.x, 20);
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `landing-${tag}.png`) });
      if (!landed) results.push([`${tag}: the turn arrived and landed`, false]);
      await page.waitForTimeout(1200);
      if (!phone) await cdp.send("Page.stopScreencast");
      const samples = await page.evaluate(() => window.__zip);

      // Ruler and lanes in lockstep: once the window leaves now, the ticks
      // ride the same transform as the layer on every frame.
      const history = samples.filter((s) => s.ticks !== "");
      const lockstep = history.every((s) => s.ticks === s.layer);
      const shifts = samples.map((s) => Number(/translate3d\(([-\d.e]+)%/.exec(s.layer)?.[1] ?? NaN));
      const moved = shifts.filter((x, i) => i > 0 && x !== shifts[i - 1]).length;
      const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
      const glide = samples.filter((s) => s.moving);
      const longFrames = gaps.filter((g, i) => samples[i + 1].moving && g > 20).length;
      results.push([`${tag}: the ruler moves with the lanes on every frame (${history.length} frames)`, history.length > 0 && lockstep]);
      results.push([`${tag}: the glide moves on ${moved} frames, ${longFrames} of them over 20ms`, moved >= 12 && longFrames <= 2]);
      results.push([`${tag}: lands, flashes, and focuses the turn (${samples.find((s) => s.focused)?.focused ?? "nothing focused"})`, samples.some((s) => s.landed) && samples.some((s) => s.focused)]);
      writeFileSync(join(out, `zip-${tag}.json`), JSON.stringify({ samples, glideFrames: glide.length }, null, 1));

      if (frames.length > 0) {
        // Twelve frames across the first 700ms, cropped to a band around the
        // lane that zipped, top to bottom.
        const start = frames[0].t;
        const glideFrames = frames.filter((f) => f.t - start <= 0.7);
        const picks = Array.from({ length: 12 }, (_, i) => glideFrames[Math.min(glideFrames.length - 1, Math.round((i * (glideFrames.length - 1)) / 11))]);
        const band = Math.max(0, jumper.y - 140);
        const strip = await browser.newPage({ deviceScaleFactor: 1 });
        await strip.setContent(
          `<style>body{margin:0;background:${scheme === "dark" ? "#000" : "#e9e9ec"};font:600 18px system-ui;color:#888}div{display:flex;align-items:center;gap:12px;padding:3px 12px}figure{margin:0;width:1440px;height:280px;overflow:hidden}img{width:1440px;display:block;margin-top:-${band}px}</style>` +
            picks.map((f) => `<div><span style="width:70px">${Math.round((f.t - start) * 1000)}ms</span><figure><img src="data:image/png;base64,${f.png.toString("base64")}"></figure></div>`).join(""),
        );
        await strip.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
        const size = await strip.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }));
        await strip.setViewportSize(size);
        await strip.screenshot({ path: join(out, `zip-frames-${tag}.png`) });
        await strip.close();
      }
      await context.close();
    }
  }
  if (target === "harness") {
    await sideBySide(browser, join(out, "rest-and-hover.png"), [
      { label: "light", png: (await import("node:fs")).readFileSync(join(out, "hover-desktop-light.png")) },
      { label: "dark", png: (await import("node:fs")).readFileSync(join(out, "hover-desktop-dark.png")) },
    ]);
  }
} finally {
  await browser.close();
}
for (const [what, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
