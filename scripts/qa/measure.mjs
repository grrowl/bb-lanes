// Measure upstream and ours element by element: boxes (relative to each
// component's root) and the computed styles that make up the look. Prints
// only what differs.
//
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/measure.mjs [light|dark] [--all]
import { HARNESS, UPSTREAM, launch, open } from "./browser.mjs";

const theme = process.argv[2] === "dark" ? "dark" : "light";
const showAll = process.argv.includes("--all");

// [name, upstream selector, our selector]
export const PAIRS = [
  ["tray", ".ui-al", ".lanes-tray"],
  ["bar", ".ui-al__bar", ".lanes-bar"],
  ["spark", ".ui-al__spark", ".hx-spark"],
  ["title", ".ui-al__title", ".hx-title"],
  ["summary", ".ui-al__summary", ".lanes-bar .lanes-summary"],
  ["summary running", ".ui-al__summary [data-kind=running]", ".lanes-bar .lanes-summary [data-kind=running]"],
  ["summary needs", ".ui-al__summary [data-kind=needs]", ".lanes-bar .lanes-summary [data-kind=needs]"],
  ["window pill", ".ui-al__window", ".lanes-pill"],
  ["card", ".ui-al__card", ".lanes-card"],
  ["tick label −25m", "text=−25m", "text=−25m"],
  ["grid line", ".ui-al__tick", ".bl-gridline:last-child"],
  ["agent cell", ".ui-al__agent", ".lanes-agent"],
  ["avatar", ".ui-al__avatar", ".lanes-avatar"],
  ["avatar logo", ".ui-al__avatar > svg", ".lanes-avatar > svg"],
  ["who", ".ui-al__who", ".lanes-who"],
  ["name line", ".ui-al__name-line", ".lanes-name-line"],
  ["name", ".ui-al__name", ".lanes-name"],
  ["model", ".ui-al__model", ".lanes-model"],
  ["state tag", ".ui-al__state[data-show] > span", ".lanes-state[data-show] > span"],
  ["slot done", ".ui-al__slot[data-status=done]", ".bl-slot[data-status=done]"],
  ["block done", ".ui-al__block[data-status=done]", ".bl-block[data-status=done]"],
  ["block running", ".ui-al__block[data-status=running]", ".bl-block[data-status=running]"],
  ["block waiting", ".ui-al__block[data-status=waiting]", ".bl-block[data-status=waiting]"],
  ["block failed", ".ui-al__block[data-status=failed]", ".bl-block[data-status=failed]"],
  ["label", ".ui-al__label", ".bl-label"],
  ["tools", ".ui-al__tools", ".bl-tools"],
  ["tool", ".ui-al__tool", ".bl-tool"],
  ["flag", ".ui-al__flag", ".bl-flag"],
  ["now pill", ".ui-al__now > span", ".bl-now-pill"],
  ["curve", ".ui-al__curves path", ".bl-curve"],
  ["lane separator", ".ui-al__track", ".bl-band"],
];

const PROPS = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color",
  "backgroundColor", "backgroundImage", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderRadius", "boxShadow", "gap", "opacity", "stroke", "strokeWidth", "strokeDasharray", "fill",
  "borderLeft", "textOverflow", "whiteSpace", "animationName", "animationDuration", "animationTimingFunction",
  "transitionProperty", "transitionDuration",
];

async function probe(page, root, selectors) {
  return page.evaluate(
    ({ root, selectors, props }) => {
      const base = document.querySelector(root)?.getBoundingClientRect();
      const find = (sel) =>
        sel.startsWith("text=")
          ? [...document.querySelectorAll("span")].find((e) => e.children.length === 0 && e.textContent === sel.slice(5))
          : document.querySelector(sel);
      return selectors.map((sel) => {
        const el = find(sel);
        if (!el || !base) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const out = { x: +(r.x - base.x).toFixed(2), y: +(r.y - base.y).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
        for (const p of props) out[p] = cs[p];
        return out;
      });
    },
    { root, selectors, props: PROPS },
  );
}

const browser = await launch();
try {
  const up = await open(browser, `${UPSTREAM}?mode=static&theme=${theme}`);
  await up.waitForSelector(".ui-al");
  const ours = await open(browser, `${HARNESS}?parity&theme=${theme}`);
  await ours.waitForSelector(".bl-block");
  await up.waitForTimeout(400);
  await ours.waitForTimeout(800);
  const a = await probe(up, ".ui-al", PAIRS.map((p) => p[1]));
  const b = await probe(ours, ".lanes-tray", PAIRS.map((p) => p[2]));
  PAIRS.forEach(([name], i) => {
    const x = a[i];
    const y = b[i];
    if (!x || !y) {
      console.log(`\n${name}: ${!x ? "missing upstream" : ""} ${!y ? "missing ours" : ""}`);
      return;
    }
    const diffs = Object.keys(x).filter((k) => showAll || String(x[k]) !== String(y[k]));
    if (diffs.length === 0) return;
    console.log(`\n${name}`);
    for (const k of diffs) console.log(`  ${k.padEnd(22)} up: ${String(x[k]).slice(0, 90)}\n  ${"".padEnd(22)} us: ${String(y[k]).slice(0, 90)}`);
  });
} finally {
  await browser.close();
}
