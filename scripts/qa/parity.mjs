// Side-by-side screenshots of upstream and ours on upstream's demo, light and
// dark: the static view, the tooltip and the decision popover open, and a
// close-up of the hand-off curve. Needs both dev servers running:
//   npx vite --config reference/affectui-agent-lanes/live/vite.config.mjs  (a local, unpublished copy of upstream; see docs/fidelity.md)
//   npx vite --config app/timeline/harness/vite.config.ts
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/parity.mjs [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HARNESS, UPSTREAM, launch, open, sideBySide } from "./browser.mjs";

const out = process.argv[2] ?? "docs/fidelity";
mkdirSync(out, { recursive: true });

const SHOTS = {
  static: null,
  tooltip: "Competitor pricing",
  decision: "Rotate API keys",
};

async function page(browser, which, theme) {
  const url = which === "upstream" ? `${UPSTREAM}?mode=static&theme=${theme}` : `${HARNESS}?parity&theme=${theme}`;
  const p = await open(browser, url, { width: 1100, height: 600 });
  await p.waitForSelector(which === "upstream" ? ".ui-al__block" : ".bl-block");
  await p.waitForTimeout(500);
  return p;
}

async function clickBlock(p, which, title) {
  const block = p.locator(which === "upstream" ? ".ui-al__block" : ".bl-block", { hasText: title }).first();
  await block.click();
  await p.waitForTimeout(450);
  // Park the pointer away, so hover does not tint the block.
  await p.mouse.move(5, 5);
  await p.waitForTimeout(350);
}

const browser = await launch();
try {
  for (const theme of ["light", "dark"]) {
    for (const [name, title] of Object.entries(SHOTS)) {
      const panels = [];
      for (const which of ["upstream", "ours"]) {
        const p = await page(browser, which, theme);
        if (title) await clickBlock(p, which, title);
        const root = await p.locator(which === "upstream" ? ".ui-al" : ".lanes-tray").boundingBox();
        const clip = { x: root.x - 24, y: root.y - 24, width: root.width + 48, height: root.height + (title ? 150 : 48) };
        panels.push({ label: which, png: await p.screenshot({ clip }) });
        if (name === "static") {
          // The hand-off curve, close up: from the Researcher's block to the Writer's.
          const curve = await p.locator(which === "upstream" ? ".ui-al__curves path" : ".bl-curve").first().boundingBox();
          const zoom = { x: curve.x - 60, y: curve.y - 24, width: curve.width + 120, height: curve.height + 48 };
          panels.push({ label: `${which}, hand-off`, png: await p.screenshot({ clip: zoom }), zoom: true });
        }
        await p.close();
      }
      const main = panels.filter((p) => !p.zoom);
      await sideBySide(browser, join(out, `parity-${name}-${theme}.png`), main, { dark: theme === "dark" });
      const zooms = panels.filter((p) => p.zoom);
      if (zooms.length) await sideBySide(browser, join(out, `parity-handoff-${theme}.png`), zooms, { dark: theme === "dark" });
      console.log(`wrote parity-${name}-${theme}.png`);
    }
  }
} finally {
  await browser.close();
}
