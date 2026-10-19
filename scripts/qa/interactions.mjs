// Interaction parity with upstream: drives upstream's demo and ours through
// the same hover, click, keyboard, decision, live-clock and narrow checks,
// prints PASS/FAIL per page and whether the two behave the same, and writes
// the raw measurements and slow-motion contact sheets. Frame sequences slow
// CSS animations and transitions with CDP's Animation.setPlaybackRate, so
// each screenshot lands on its animation time; the demo clocks are untouched.
// Pages never connect Vite's HMR socket, so edits elsewhere in the worktree
// cannot reload a page mid-check.
// Needs both dev servers running:
//   npx vite --config reference/affectui-agent-lanes/live/vite.config.mjs  (a local, unpublished copy of upstream; see docs/fidelity.md)
//   npx vite --config app/timeline/harness/vite.config.ts
//   PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/interactions.mjs [outDir]
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESS, UPSTREAM, launch } from "./browser.mjs";

const out = process.argv[2] ?? "/tmp/lanes-fid/interactions";
mkdirSync(out, { recursive: true });

const SIDES = [
  {
    name: "upstream",
    url: { static: `${UPSTREAM}?mode=static`, live: UPSTREAM },
    S: {
      root: ".ui-al",
      track: ".ui-al__track",
      clip: ".ui-al__clip",
      slot: ".ui-al__slot",
      block: ".ui-al__block",
      pop: ".ui-al__pop",
      tip: ".ui-al__tip",
      ask: ".ui-al__ask",
      approve: ".ui-al__btn--primary",
      reject: ".ui-al__btn:not(.ui-al__btn--primary)",
      flag: ".ui-al__flag",
      pulse: ".ui-al__flag",
      state: ".ui-al__state",
      curve: ".ui-al__curves path",
      liveCurve: ".ui-al__curves path[data-live]",
      agent: ".ui-al__agent",
      who: ".ui-al__who",
      needs: ".ui-al__summary [data-kind=needs]",
      firstStop: ".ui-al__block",
      caption: null,
    },
  },
  {
    name: "ours",
    url: { static: `${HARNESS}?parity`, live: `${HARNESS}?parity=live` },
    S: {
      root: ".lanes-tray",
      track: ".bl-track",
      clip: ".bl-clip",
      slot: ".bl-slot",
      block: ".bl-block",
      pop: ".bl-pop",
      tip: ".bl-tip",
      ask: ".bl-ask",
      approve: ".bl-btn--primary",
      reject: ".bl-btn:not(.bl-btn--primary)",
      flag: ".bl-flag",
      pulse: ".bl-flag-mark",
      state: ".lanes-state",
      curve: ".bl-curve",
      liveCurve: ".bl-curve[data-live]",
      agent: ".lanes-agent",
      who: ".lanes-who",
      needs: ".lanes-bar .lanes-summary [data-kind=needs]",
      firstStop: '.bl-block[tabindex="0"]',
      caption: ".bl-caption",
    },
  },
];

// Upstream's demo: four lanes of 48px, a 30-minute window, a clock 30x real time.
const LANE = { "Competitor pricing": 0, "Customer interviews": 0, "Draft pricing page": 1, "PR #482 billing": 2, "Review pricing copy": 2, "Sync CRM": 3, "Rotate API keys": 3 };
const SPAN_MINUTES = 30;
const SPEED = 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

// ----- Pages -----

/** Vite's client gets a socket that never opens: no hot updates, no reloads. */
function noHmr() {
  const Socket = window.WebSocket;
  window.WebSocket = new Proxy(Socket, {
    construct: (Real, args) => (String(args[1] ?? "").includes("vite-hmr") ? new EventTarget() : new Real(...args)),
  });
}

let pages = [];
/** Like browser.mjs's `open`, with HMR off and reduced motion set before the first paint. */
async function load(browser, side, mode = "static", { width = 1100, height = 600, reducedMotion = false } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  pages.push(page);
  page.on("pageerror", (error) => console.error(`[page error] ${side.name}: ${error.message}`));
  await page.addInitScript(noHmr);
  await page.goto(side.url[mode]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector(side.S.block);
  await page.waitForTimeout(mode === "static" ? 500 : 100);
  await page.mouse.move(2, 2);
  return page;
}

/** In-page helpers, installed once per evaluate. */
const LIB = `
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
  const blockOf = (title) => [...document.querySelectorAll(S.block)].find((b) => b.textContent.trim() === title) ?? null;
  const slotOf = (title) => blockOf(title)?.closest(S.slot) ?? null;
  const describe = (el) => {
    if (!el || el === document.body) return "body";
    if (el.matches(S.block)) return el.textContent.trim();
    if (el.matches(S.approve)) return "Approve button";
    if (el.matches(S.reject)) return "Reject button";
    const text = el.textContent.trim().slice(0, 24);
    return el.tagName.toLowerCase() + "." + [...el.classList].join(".") + (text ? ' "' + text + '"' : "");
  };
`;
function inPage(page, S, body, arg) {
  // eslint-disable-next-line no-new-func
  return page.evaluate(({ S, src, arg }) => new Function("S", "arg", src)(S, arg), { S, src: LIB + body, arg });
}

const blockBox = (p, S, title) => inPage(p, S, "const b = blockOf(arg); return b && box(b);", title);
const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
async function clickBlock(p, S, title) {
  const at = centre(await blockBox(p, S, title));
  await p.mouse.click(at.x, at.y);
}
const focusBlock = (p, S, title) => inPage(p, S, "blockOf(arg).focus(); return describe(document.activeElement);", title);
const popState = (p, S) =>
  inPage(
    p,
    S,
    `const pop = document.querySelector(S.pop);
     return { open: !!pop, tip: !!document.querySelector(S.tip), ask: !!document.querySelector(S.ask),
       up: pop ? pop.hasAttribute("data-up") : null, openBlocks: [...document.querySelectorAll(S.block + "[data-open]")].map(describe),
       active: describe(document.activeElement) };`,
  );

/** Demo minutes since the live script started, read off where PR #482 (−29m) sits on the track. */
const demoMinutes = (p, S) =>
  inPage(
    p,
    S,
    `const slot = slotOf("PR #482 billing"); const track = document.querySelector(S.track);
     if (!slot || !track) return null;
     const t = box(track); return 1 - ${SPAN_MINUTES} * ((box(slot).x - t.x) / t.w);`,
  );
async function untilMinute(p, S, minute) {
  for (let i = 0; i < 1200; i += 1) {
    const now = await demoMinutes(p, S);
    if (now !== null && now >= minute) return now;
    await sleep(40);
  }
  throw new Error(`demo never reached minute ${minute}`);
}

// ----- Slow motion and contact sheets -----

async function slowMotion(p, rate) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  return cdp;
}

/** `count` frames `every` ms apart in animation time, with animations slowed by `rate`. */
async function filmstrip(p, { clip, count, every, rate, t0 = Date.now(), probe }) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const lag = t0 + (i * every) / rate - Date.now();
    if (lag > 0) await sleep(lag);
    const t = Math.round((Date.now() - t0) * rate);
    const data = probe ? await probe() : undefined;
    frames.push({ t, data, png: await p.screenshot({ clip }) });
  }
  return frames;
}

/**
 * Labelled PNGs in one PNG: frames top to bottom (`column`), or panels side by
 * side. Not browser.mjs's `sideBySide`: that measures and takes a full-page
 * shot before data-URI images decode, and tall sheets come out with their top
 * repeated at the bottom.
 */
async function compose(browser, panels, { column = false } = {}) {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 4000, height: 4000 } });
  const cells = panels
    .map(({ label, png }) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${png.toString("base64")}"></figure>`)
    .join("");
  await page.setContent(`<!doctype html><style>
    body{margin:0;display:flex;align-items:flex-start;width:max-content;height:max-content;background:#e9e9ec;color:#444}
    body.row{gap:16px;padding:16px;font:600 22px/1.2 system-ui}
    body.row figcaption{padding:4px 4px 10px}body.row img{border-radius:8px}
    body.column{flex-direction:column;gap:6px;padding:8px;background:#fff;font:500 18px/1.2 ui-monospace,monospace}
    body.column figure{display:flex;align-items:center;gap:12px}body.column figcaption{width:110px;text-align:right}
    figure{margin:0}img{display:block}
  </style><body class="${column ? "column" : "row"}">${cells}</body>`);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  // The body's own box (standards mode, so it is only as tall as its content).
  const size = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  await page.setViewportSize(size);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await page.screenshot();
  await page.close();
  return png;
}

const written = [];
async function writeSheet(browser, name, panels) {
  const path = join(out, name);
  writeFileSync(path, await compose(browser, panels));
  written.push(path);
}
async function sheet(browser, name, strips) {
  const panels = [];
  for (const [label, frames] of strips) panels.push({ label, png: await compose(browser, frames, { column: true }) });
  await writeSheet(browser, name, panels);
}
const strip = (frames, label = (f) => `${f.t}ms`) => frames.map((f) => ({ label: label(f), png: f.png }));
const bare = (frames) => frames.map(({ png, ...rest }) => rest);

// Computed styles, as compact records.
const ANIM = `const anim = (el, pseudo) => { if (!el) return null; const c = getComputedStyle(el, pseudo);
  return { name: c.animationName, duration: c.animationDuration, timing: c.animationTimingFunction, iterations: c.animationIterationCount, delay: c.animationDelay }; };
  const trans = (el, pseudo) => { if (!el) return null; const c = getComputedStyle(el, pseudo);
  return { property: c.transitionProperty, duration: c.transitionDuration, timing: c.transitionTimingFunction, delay: c.transitionDelay }; };`;

// ----- The checks -----

const CHECKS = [
  {
    n: 1,
    name: "Hover fill",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      const bg = () => inPage(p, S, `return getComputedStyle(blockOf("Competitor pricing")).backgroundColor;`);
      const before = await bg();
      const at = centre(await blockBox(p, S, "Competitor pricing"));
      await p.mouse.move(at.x, at.y);
      await p.waitForTimeout(500);
      const after = await bg();
      await p.mouse.move(2, 2);
      await p.waitForTimeout(500);
      const left = await bg();
      return { pass: before !== after && left === before, before, hovered: after, afterLeave: left };
    },
    compare: (a, b) => diffKeys(a, b, ["before", "hovered", "afterLeave"]),
  },
  {
    n: 2,
    name: "Click to open/close",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      await clickBlock(p, S, "Competitor pricing");
      await p.waitForTimeout(350);
      const opened = await popState(p, S);
      await clickBlock(p, S, "Competitor pricing");
      await p.waitForTimeout(350);
      const closed = await popState(p, S);
      return { pass: opened.tip && opened.openBlocks.includes("Competitor pricing") && !closed.open && closed.openBlocks.length === 0, opened, closed };
    },
    compare: (a, b) => diffKeys(a, b, ["opened.tip", "opened.openBlocks", "closed.open"]),
  },
  {
    n: 3,
    name: "Pointer-down outside closes",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      await clickBlock(p, S, "Competitor pricing");
      await p.waitForTimeout(350);
      const opened = await popState(p, S);
      // Inside the tooltip: stays open.
      const tip = await inPage(p, S, "return box(document.querySelector(S.tip));");
      await p.mouse.move(tip.x + 12, tip.y + 10);
      await p.mouse.down();
      await p.waitForTimeout(50);
      const insideOnDown = (await popState(p, S)).open;
      await p.mouse.up();
      await p.waitForTimeout(200);
      // Empty card space clear of the tooltip: Ops' lane between Sync CRM and Rotate API keys.
      const spot = await inPage(p, S, "const t = box(document.querySelector(S.track)); const a = box(document.querySelectorAll(S.agent)[3]); return { x: t.x + t.w * 0.45, y: a.y + a.h * 0.75 };");
      await p.mouse.move(spot.x, spot.y);
      await p.mouse.down();
      await p.waitForTimeout(50);
      const outsideOnDown = (await popState(p, S)).open;
      await p.mouse.up();
      await p.waitForTimeout(250);
      const afterUp = await popState(p, S);
      return { pass: opened.tip && insideOnDown && !outsideOnDown && !afterUp.open, opened: opened.tip, openAfterPointerDownInside: insideOnDown, openAfterPointerDownOutside: outsideOnDown, openAfterUp: afterUp.open };
    },
    compare: (a, b) => diffKeys(a, b, ["openAfterPointerDownInside", "openAfterPointerDownOutside", "openAfterUp"]),
  },
  {
    n: 4,
    name: "Esc restores focus",
    async run(browser, side) {
      const { S } = side;
      const result = {};
      for (const [kind, title] of [["tooltip", "Competitor pricing"], ["decision", "Rotate API keys"]]) {
        const p = await load(browser, side);
        await focusBlock(p, S, title);
        await p.keyboard.press("Enter");
        await p.waitForTimeout(350);
        const opened = await popState(p, S);
        await p.keyboard.press("Escape");
        await p.waitForTimeout(300);
        const closed = await popState(p, S);
        result[kind] = { opened: opened.open, focusWhileOpen: opened.active, closed: !closed.open, focusAfterEsc: closed.active };
      }
      const ok = (r, title) => r.opened && r.closed && r.focusAfterEsc === title;
      return { pass: ok(result.tooltip, "Competitor pricing") && ok(result.decision, "Rotate API keys"), ...result };
    },
    compare: (a, b) => diffKeys(a, b, ["tooltip.focusWhileOpen", "tooltip.focusAfterEsc", "decision.focusWhileOpen", "decision.focusAfterEsc"]),
  },
  {
    n: 5,
    name: "Tab order",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      // What is drawn before anything takes focus: focusing a block outside the window scrolls the clip.
      const drawn = await inPage(
        p,
        S,
        `const t = box(document.querySelector(S.track));
         return [...document.querySelectorAll(S.block)].filter((b) => { const r = box(b); return r.right > t.x && r.x < t.right; }).map(describe);`,
      );
      const step = `return { who: describe(document.activeElement), clipScroll: document.querySelector(S.clip).scrollLeft };`;
      const sequence = [await inPage(p, S, `document.querySelector(S.firstStop).focus(); ${step}`)];
      for (let i = 0; i < 8; i += 1) {
        await p.keyboard.press("Tab");
        await p.waitForTimeout(60);
        sequence.push(await inPage(p, S, step));
      }
      const expected = ["Competitor pricing", "Customer interviews", "Draft pricing page", "PR #482 billing", "Sync CRM", "Rotate API keys"];
      const shown = sequence.map((s) => s.who).filter((who) => drawn.includes(who));
      return {
        pass: expected.every((title, i) => shown[i] === title),
        sequence: sequence.map((s) => (s.who.includes(".") || s.who === "body" || drawn.includes(s.who) ? s.who : `${s.who} (not drawn)`)),
        clipScroll: sequence.map((s) => s.clipScroll),
      };
    },
    compare: (a, b) => diffKeys(a, b, ["sequence", "clipScroll"]),
  },
  {
    n: 6,
    name: "Enter opens",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      await focusBlock(p, S, "Competitor pricing");
      await p.keyboard.press("Enter");
      await p.waitForTimeout(350);
      const done = await popState(p, S);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(250);
      await focusBlock(p, S, "Rotate API keys");
      await p.keyboard.press("Enter");
      await p.waitForTimeout(350);
      const waiting = await popState(p, S);
      return { pass: done.tip && !done.ask && waiting.ask && !waiting.tip, doneOpensTooltip: done.tip, waitingOpensDecision: waiting.ask };
    },
    compare: (a, b) => diffKeys(a, b, ["doneOpensTooltip", "waitingOpensDecision"]),
  },
  {
    n: 7,
    name: "Approve autofocus",
    async run(browser, side) {
      const { S } = side;
      const isApprove = `return { active: describe(document.activeElement), approve: document.activeElement?.matches(S.approve) ?? false };`;
      let p = await load(browser, side);
      await clickBlock(p, S, "Rotate API keys");
      await p.waitForTimeout(350);
      const byClick = await inPage(p, S, isApprove);
      p = await load(browser, side);
      await focusBlock(p, S, "Rotate API keys");
      await p.keyboard.press("Enter");
      await p.waitForTimeout(350);
      const byEnter = await inPage(p, S, isApprove);
      return { pass: byClick.approve && byEnter.approve, byClick: byClick.active, byEnter: byEnter.active };
    },
    compare: (a, b) => diffKeys(a, b, ["byClick", "byEnter"]),
  },
  {
    n: 8,
    name: "Approve → running, Reject → failed",
    async run(browser, side) {
      const { S } = side;
      const result = {};
      for (const [decision, button, expect] of [["approve", S.approve, "running"], ["reject", S.reject, "failed"]]) {
        const p = await load(browser, side);
        await clickBlock(p, S, "Rotate API keys");
        await p.waitForTimeout(400);
        const geometry = await inPage(
          p,
          S,
          `const root = box(document.querySelector(S.root)); const lane = box(document.querySelectorAll(S.agent)[3]);
           const button = box(document.querySelector(arg)); return { root, lane, button };`,
          button,
        );
        const transition = await inPage(p, S, `${ANIM} return trans(blockOf("Rotate API keys"));`);
        const clip = { x: geometry.root.x, y: geometry.lane.y - 4, width: geometry.root.w, height: geometry.lane.h + 8 };
        const probe = () =>
          inPage(
            p,
            S,
            `const b = blockOf("Rotate API keys"); const c = b && getComputedStyle(b);
             return { status: b?.dataset.status ?? null, background: c?.backgroundColor ?? null, color: c?.color ?? null,
               flag: !!document.querySelector(S.flag), flagOpacity: document.querySelector(S.flag) ? getComputedStyle(document.querySelector(S.flag)).opacity : null,
               popover: !!document.querySelector(S.pop) };`,
          );
        const cdp = await slowMotion(p, 0.1);
        const t0 = Date.now();
        await p.mouse.click(geometry.button.x + geometry.button.w / 2, geometry.button.y + geometry.button.h / 2);
        const frames = await filmstrip(p, { clip, count: 13, every: 50, rate: 0.1, t0, probe });
        await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
        const final = await probe();
        result[decision] = { pass: final.status === expect, final: final.status, transition, frames };
      }
      return { pass: result.approve.pass && result.reject.pass, ...result };
    },
    async sheets(browser, results) {
      for (const decision of ["approve", "reject"]) {
        await sheet(
          browser,
          `${decision}-frames.png`,
          SIDES.map((s) => [s.name, strip(results[s.name][decision].frames, (f) => `${f.t}ms ${f.data.status}`)]),
        );
        for (const s of SIDES) results[s.name][decision].frames = bare(results[s.name][decision].frames);
      }
    },
    compare: (a, b) => [
      ...diffKeys(a, b, ["approve.final", "reject.final", "approve.transition", "reject.transition"]),
      ...frameDiffs(a.approve.frames, b.approve.frames, "approve", ["background", "flag", "popover"]),
      ...frameDiffs(a.reject.frames, b.reject.frames, "reject", ["background", "flag", "popover"]),
    ],
  },
  {
    n: 9,
    name: "Popover data-up",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      // Upstream opens upward from the lower half of the lanes: row index >= rows / 2.
      const cases = [["Rotate API keys", "ask", true], ["Sync CRM", "tip", true], ["PR #482 billing", "tip", true], ["Competitor pricing", "tip", false]];
      const result = {};
      for (const [title, kind, up] of cases) {
        await clickBlock(p, S, title);
        await p.waitForTimeout(450);
        const placed = await inPage(
          p,
          S,
          `const pop = document.querySelector(S.pop); if (!pop) return null;
           const r = box(pop); const t = box(document.querySelector(S.track)); const lane = box(document.querySelectorAll(S.agent)[arg]);
           const n = (v) => Math.round(v * 10) / 10;
           const kind = pop.matches(S.ask) ? "ask" : pop.matches(S.tip) ? "tip" : "?"; const up = pop.hasAttribute("data-up");
           return { kind, up, top: n(r.y - lane.y), bottom: n(r.bottom - lane.y), left: n(r.x - t.x), right: n(t.right - r.right), width: n(r.w), height: n(r.h),
             anchorY: n(up ? r.bottom - lane.y : r.y - lane.y), anchorX: n(kind === "tip" ? r.x + r.w / 2 - t.x : t.right - r.right) };`,
          LANE[title],
        );
        result[title] = { expectUp: up, ...placed, ok: !!placed && placed.kind === kind && placed.up === up };
        await p.keyboard.press("Escape");
        await p.mouse.move(2, 2);
        await p.waitForTimeout(300);
      }
      return { pass: Object.values(result).every((r) => r.ok), ...result };
    },
    compare: (a, b) =>
      Object.keys(a)
        .filter((k) => k !== "pass")
        .flatMap((k) => diffKeys(a[k], b[k], ["up", "anchorY", "anchorX", "width", "height"], 1).map((d) => `${k} ${d}`)),
  },
  {
    n: 10,
    name: "Tooltip clamping (live)",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side, "live");
      const measure = (title) =>
        inPage(
          p,
          S,
          `const t = box(document.querySelector(S.track)); const b = box(blockOf(arg)); const tip = document.querySelector(S.tip);
           const f0 = Math.max(0, (b.x - t.x) / t.w), f1 = Math.min(1, (b.right - t.x) / t.w);
           const r = tip && box(tip);
           return { visibleCentre: (f0 + f1) / 2, tipCentre: r ? (r.x + r.w / 2 - t.x) / t.w : null, styleLeft: tip?.style.left ?? null };`,
          title,
        );
      const result = {};
      for (const [title, minute, clamp] of [["PR #482 billing", 6, 0.14], ["Review pricing copy", 6.5, 0.86]]) {
        result[title] = { at: +(await untilMinute(p, S, minute)).toFixed(2) };
        const b = await blockBox(p, S, title);
        const t = await inPage(p, S, "return box(document.querySelector(S.track));");
        const x0 = Math.max(b.x, t.x);
        const x1 = Math.min(b.right, t.right);
        await p.mouse.click((x0 + x1) / 2, b.y + b.h / 2);
        await p.waitForTimeout(350);
        const m = await measure(title);
        const edge = clamp < 0.5 ? m.visibleCentre < clamp : m.visibleCentre > clamp;
        Object.assign(result[title], {
          visibleCentre: +m.visibleCentre.toFixed(4),
          tipCentre: m.tipCentre === null ? null : +m.tipCentre.toFixed(4),
          styleLeft: m.styleLeft,
          ok: edge && m.tipCentre !== null && near(m.tipCentre, clamp, 0.004),
        });
      }
      return { pass: Object.values(result).every((r) => r.ok), ...result };
    },
    compare: (a, b) =>
      ["PR #482 billing", "Review pricing copy"].flatMap((k) => diffKeys(a[k], b[k], ["tipCentre"], 0.003).map((d) => `${k} ${d}`)),
  },
  {
    n: 11,
    name: "Live sliding and the left mask",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side, "live");
      await p.waitForTimeout(1500);
      const sampled = await inPage(
        p,
        S,
        `return new Promise((resolve) => {
           const samples = []; const t0 = performance.now();
           const take = () => {
             const t = box(document.querySelector(S.track));
             samples.push({ t: (performance.now() - t0) / 1000, x: box(slotOf("Competitor pricing")).x - t.x, width: t.w });
             if (samples.length < 21) setTimeout(take, 100); else resolve(samples);
           };
           take();
         });`,
      );
      const n = sampled.length;
      const mt = sampled.reduce((s, v) => s + v.t, 0) / n;
      const mx = sampled.reduce((s, v) => s + v.x, 0) / n;
      const slope = sampled.reduce((s, v) => s + (v.t - mt) * (v.x - mx), 0) / sampled.reduce((s, v) => s + (v.t - mt) ** 2, 0);
      const residual = Math.max(...sampled.map((v) => Math.abs(v.x - (mx + slope * (v.t - mt)))));
      const width = sampled[0].width;
      const expected = (width / (SPAN_MINUTES * 60)) * SPEED;
      const mask = await inPage(p, S, `const c = getComputedStyle(document.querySelector(S.clip)); return { mask: c.maskImage, webkit: c.webkitMaskImage };`);
      const normal = (v) => v.replace(/rgba\(0, 0, 0, 0\)/g, "transparent");
      const maskOk = [mask.mask, mask.webkit].every((v) => normal(v) === "linear-gradient(to right, transparent 0px, rgb(0, 0, 0) 40px)");
      return {
        pass: near(-slope / expected, 1, 0.03) && maskOk,
        trackWidth: width,
        pxPerSecond: +(-slope).toFixed(3),
        expectedPxPerSecond: +expected.toFixed(3),
        maxResidualPx: +residual.toFixed(3),
        mask,
        samples: sampled.map((v) => ({ t: +v.t.toFixed(3), x: +v.x.toFixed(2) })),
      };
    },
    compare: (a, b) => [...diffKeys(a, b, ["pxPerSecond"], 0.15), ...diffKeys(a, b, ["mask"])],
  },
  {
    n: 12,
    name: "Shimmer, pulse and flow timings",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      const timings = await inPage(
        p,
        S,
        `${ANIM}
         const keyframes = (name) => {
           for (const sheet of document.styleSheets) {
             let rules; try { rules = sheet.cssRules; } catch { continue; }
             for (const rule of rules) if (rule instanceof CSSKeyframesRule && rule.name === name)
               return rule.cssText.replace(name, "K").replace(/\\s+/g, " ");
           }
           return null;
         };
         const withFrames = (a) => a && { ...a, keyframes: a.name === "none" ? null : keyframes(a.name) };
         const running = document.querySelector(S.block + "[data-status=running]");
         return {
           shimmer: withFrames(anim(running, "::after")),
           flag: withFrames(anim(document.querySelector(S.pulse))),
           needsDot: withFrames(anim(document.querySelector(S.needs), "::before")),
           curve: withFrames(anim(document.querySelector(S.liveCurve))),
         };`,
      );
      const ok = (a) => a && a.name !== "none" && a.iterations === "infinite";
      return { pass: Object.values(timings).every(ok), ...timings };
    },
    compare: (a, b) =>
      ["shimmer", "flag", "needsDot", "curve"].flatMap((k) => diffKeys(a[k] ?? {}, b[k] ?? {}, ["duration", "timing", "iterations", "delay", "keyframes"]).map((d) => `${k} ${d}`)),
  },
  {
    n: 13,
    name: "State tag collapse and expand",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      const read = `${ANIM}
        const tags = [...document.querySelectorAll(S.agent)].map((a) => a.querySelector(S.state));
        const shown = tags.find((t) => t.hasAttribute("data-show")); const hidden = tags.find((t) => !t.hasAttribute("data-show"));
        const values = (t) => { const c = getComputedStyle(t); return { columns: c.gridTemplateColumns, marginLeft: c.marginLeft, opacity: c.opacity, width: +box(t).w.toFixed(2) }; };
        return { shown: { ...trans(shown), ...values(shown) }, hidden: { ...trans(hidden), ...values(hidden) } };`;
      const transitions = await inPage(p, S, read);

      // Live: Ops' "Needs you" collapses when its waiting turn runs, at demo minute 9.
      const live = await load(browser, side, "live");
      await inPage(
        live,
        S,
        `window.__opsRan = null;
         let shown = false;
         const watch = () => {
           const tag = document.querySelectorAll(S.agent)[3]?.querySelector(S.state);
           if (tag?.hasAttribute("data-show")) shown = true;
           if (shown && tag && !tag.hasAttribute("data-show")) window.__opsRan = performance.now();
           else requestAnimationFrame(watch);
         };
         watch();`,
      );
      await untilMinute(live, S, 8.7);
      const cell = await inPage(live, S, "return box(document.querySelectorAll(S.agent)[3]);");
      const rate = 0.1;
      const cdp = await slowMotion(live, rate);
      const probe = () =>
        inPage(
          live,
          S,
          `const tag = document.querySelectorAll(S.agent)[3].querySelector(S.state); const c = getComputedStyle(tag);
           const label = tag.firstElementChild; const lc = getComputedStyle(label);
           return { perf: performance.now(), show: tag.hasAttribute("data-show"), columns: c.gridTemplateColumns, marginLeft: c.marginLeft,
             opacity: c.opacity, width: +box(tag).w.toFixed(2), text: label.textContent, background: lc.backgroundColor, color: lc.color };`,
        );
      const frames = await filmstrip(live, {
        clip: { x: cell.x, y: cell.y, width: cell.w, height: cell.h },
        count: 16,
        every: 50,
        rate,
        probe,
      });
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      const ran = await live.evaluate(() => window.__opsRan);
      for (const f of frames) f.t = ran === null ? null : Math.round((f.data.perf - ran) * rate);
      const last = frames.at(-1).data;
      const collapsed = ran !== null && !last.show && last.opacity === "0" && last.width <= transitions.hidden.width + 0.5;
      return { pass: collapsed, transitions, ranAtMinute9: ran !== null, frames };
    },
    async sheets(browser, results) {
      await sheet(
        browser,
        "state-tag-frames.png",
        SIDES.map((s) => [s.name, strip(results[s.name].frames, (f) => (f.t === null ? "?" : `${f.t >= 0 ? "+" : ""}${f.t}ms`))]),
      );
      for (const s of SIDES) results[s.name].frames = bare(results[s.name].frames).map(({ t, data: { perf, ...data } }) => ({ t, ...data }));
    },
    compare: (a, b) => [
      ...["shown", "hidden"].flatMap((k) => diffKeys(a.transitions[k], b.transitions[k], ["property", "duration", "timing", "delay", "columns", "marginLeft", "opacity", "width"], 0.5).map((d) => `${k} ${d}`)),
      ...collapseDiffs(a.frames, b.frames),
    ],
  },
  {
    n: 14,
    name: "Reduced motion",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side, "static", { reducedMotion: true });
      await clickBlock(p, S, "Rotate API keys");
      await p.waitForTimeout(300);
      const scan = await inPage(
        p,
        S,
        `${ANIM}
         const moving = (el, pseudo) => { const c = getComputedStyle(el, pseudo);
           const animated = c.animationName !== "none"; const transitioned = c.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
           return animated || transitioned ? describe(el) + (pseudo ?? "") + " " + (animated ? c.animationName + " " + c.animationDuration : "") + (transitioned ? " transition " + c.transitionProperty + " " + c.transitionDuration : "") : null; };
         const root = document.querySelector(S.root);
         const offenders = [];
         for (const el of [root, ...root.querySelectorAll("*")]) for (const pseudo of [undefined, "::before", "::after"]) { const m = moving(el, pseudo); if (m) offenders.push(m); }
         const running = document.querySelector(S.block + "[data-status=running]");
         return {
           offenders: [...new Set(offenders)],
           runningAnimations: document.getAnimations().filter((a) => root.contains(a.effect?.target)).length,
           spot: {
             shimmer: anim(running, "::after").name,
             flag: anim(document.querySelector(S.pulse)).name,
             curve: anim(document.querySelector(S.liveCurve)).name,
             needsDot: anim(document.querySelector(S.needs), "::before").name,
             stateTag: trans(document.querySelector(S.state)).duration,
             block: trans(running).duration,
             popover: anim(document.querySelector(S.pop)).name,
           },
         };`,
      );
      return { pass: scan.offenders.length === 0 && scan.runningAnimations === 0, ...scan };
    },
    compare: (a, b) => diffKeys(a, b, ["offenders", "runningAnimations", "spot"]),
  },
  {
    n: 15,
    name: "Narrow container (<520px)",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side, "static", { width: 500 });
      await p.waitForTimeout(300);
      const measured = await inPage(
        p,
        S,
        `const root = box(document.querySelector(S.root)); const agent = box(document.querySelector(S.agent)); const who = document.querySelector(S.who);
         return { rootWidth: +root.w.toFixed(1), agentWidth: +agent.w.toFixed(1), trackWidth: +box(document.querySelector(S.track)).w.toFixed(1),
           whoDisplay: getComputedStyle(who).display, whoWidth: +box(who).w.toFixed(1),
           captions: S.caption ? [...document.querySelectorAll(S.caption)].map((c) => c.textContent.trim()) : [] };`,
      );
      const root = await inPage(p, S, "return box(document.querySelector(S.root));");
      const png = await p.screenshot({ clip: { x: root.x - 16, y: root.y - 16, width: root.w + 32, height: root.h + 32 } });
      return { pass: measured.rootWidth < 520 && near(measured.agentWidth, 48, 0.5) && measured.whoWidth === 0, ...measured, png };
    },
    async sheets(browser, results) {
      await writeSheet(browser, "narrow-500.png", SIDES.map((s) => ({ label: s.name, png: results[s.name].png })));
      for (const s of SIDES) delete results[s.name].png;
    },
    compare: (a, b) => diffKeys(a, b, ["rootWidth", "agentWidth", "trackWidth", "whoDisplay", "captions"]),
  },
  {
    n: 16,
    name: "Curve flowing (extra, contact sheet)",
    async run(browser, side) {
      const { S } = side;
      const p = await load(browser, side);
      const c = await inPage(p, S, "return box(document.querySelector(S.liveCurve));");
      const clip = { x: c.x - 40, y: c.y - 20, width: c.w + 80, height: c.h + 40 };
      const probe = () => inPage(p, S, "const c = getComputedStyle(document.querySelector(S.liveCurve)); return { offset: c.strokeDashoffset, stroke: c.stroke };");
      const rate = 0.25;
      const cdp = await slowMotion(p, rate);
      const frames = await filmstrip(p, { clip, count: 11, every: 100, rate, probe });
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      // The dash travels one 6px cycle per animation period; unwrap the jumps back to 0.
      const offsets = frames.map((f) => parseFloat(f.data.offset));
      let travel = 0;
      for (let i = 1; i < offsets.length; i += 1) {
        const step = offsets[i] - offsets[i - 1];
        travel += step > 0.01 ? step - 6 : step;
      }
      const flowPxPerSecond = +(travel / ((frames.at(-1).t - frames[0].t) / 1000)).toFixed(3);
      return { pass: near(flowPxPerSecond, -6 / 0.9, 0.5), flowPxPerSecond, frames };
    },
    async sheets(browser, results) {
      await sheet(browser, "curve-flow-frames.png", SIDES.map((s) => [s.name, strip(results[s.name].frames, (f) => `${f.t}ms ${parseFloat(f.data.offset).toFixed(2)}`)]));
      for (const s of SIDES) results[s.name].frames = bare(results[s.name].frames).map(({ t, data }) => ({ t, ...data }));
    },
    compare: (a, b) => [...diffKeys(a, b, ["flowPxPerSecond"], 0.3), ...diffKeys(a.frames[0], b.frames[0], ["stroke"])],
  },
];

// ----- Comparing -----

const get = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
/** Keys whose values differ, as "key: upstream X, ours Y". Numbers within `tolerance` count as equal. */
function diffKeys(a, b, keys, tolerance = 0) {
  return keys.flatMap((k) => {
    const x = get(a, k);
    const y = get(b, k);
    const same = typeof x === "number" && typeof y === "number" ? Math.abs(x - y) <= tolerance : show(x) === show(y);
    return same ? [] : [`${k}: upstream ${show(x)}, ours ${show(y)}`];
  });
}
/** rgb()/rgba() channels; two colours within 4/255 per channel and 0.03 alpha count as one. */
const channels = (v) => (/^rgba?\(/.test(v ?? "") ? v.match(/[\d.]+/g).map(Number).concat(1).slice(0, 4) : null);
function sameValue(x, y) {
  const [p, q] = [channels(x), channels(y)];
  if (!p || !q) return x === y;
  return p.every((c, i) => Math.abs(c - q[i]) <= (i === 3 ? 0.03 : 4));
}
function frameDiffs(a, b, label, keys) {
  return keys.flatMap((k) => {
    const x = a.map((f) => `${f.t}:${show(f.data[k])}`);
    const y = b.map((f) => `${f.t}:${show(f.data[k])}`);
    const xs = a.map((f) => show(f.data[k]));
    const ys = b.map((f) => show(f.data[k]));
    const first = xs.findIndex((v, i) => !sameValue(v, ys[i]));
    if (first === -1) return [];
    return [`${label} ${k} first differs at frame ${first} (${a[first]?.t}ms): upstream ${xs[first]}, ours ${ys[first]}; upstream ${compress(x)} | ours ${compress(y)}`];
  });
}
/** Runs of equal values, so a frame series reads short. */
function compress(series) {
  const runs = [];
  for (const s of series) {
    const [t, ...rest] = s.split(":");
    const v = rest.join(":");
    if (runs.at(-1)?.v === v) runs.at(-1).to = t;
    else runs.push({ from: t, to: t, v });
  }
  return runs.map((r) => `${r.from}${r.to !== r.from ? `–${r.to}` : ""}ms ${r.v}`).join(", ");
}
function collapseDiffs(a, b) {
  // Compare the tag's width and opacity at matching animation times after the change.
  const at = (frames, t) => frames.filter((f) => f.t !== null).reduce((best, f) => (Math.abs(f.t - t) < Math.abs((best?.t ?? Infinity) - t) ? f : best), null);
  const diffs = [];
  for (const t of [0, 100, 200, 300, 400, 600]) {
    const x = at(a, t);
    const y = at(b, t);
    if (!x || !y) continue;
    const d = [];
    if (Math.abs(x.width - y.width) > 3) d.push(`width ${x.width} vs ${y.width}`);
    if (Math.abs(parseFloat(x.opacity) - parseFloat(y.opacity)) > 0.1) d.push(`opacity ${x.opacity} vs ${y.opacity}`);
    if (!sameValue(x.background, y.background)) d.push(`tag background ${x.background} vs ${y.background}`);
    if (x.text !== y.text) d.push(`text "${x.text}" vs "${y.text}"`);
    if (d.length) diffs.push(`live ~${t}ms (upstream ${x.t}ms, ours ${y.t}ms): ${d.join(", ")}`);
  }
  return diffs;
}

// ----- Run -----

const browser = await launch();
const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
const report = {
  when: new Date().toISOString(),
  commit: git("rev-parse --short HEAD"),
  uncommitted: git("status --porcelain -- app shared").split("\n").filter(Boolean),
  upstream: SIDES[0].url,
  ours: SIDES[1].url,
  checks: [],
};
let failed = false;
try {
  for (const check of CHECKS) {
    const results = {};
    for (const side of SIDES) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          results[side.name] = await check.run(browser, side);
          break;
        } catch (error) {
          results[side.name] = { pass: false, error: String(error?.message ?? error).split("\n")[0] };
          if (!/context was destroyed|navigat/i.test(results[side.name].error)) break;
        } finally {
          for (const page of pages) await page.close().catch(() => {});
          pages = [];
        }
      }
    }
    if (check.sheets && SIDES.every((s) => !results[s.name].error)) await check.sheets(browser, results);
    const [a, b] = SIDES.map((s) => results[s.name]);
    let diffs;
    try {
      diffs = a.error || b.error ? [`error: ${a.error ?? b.error}`] : check.compare(a, b);
    } catch (error) {
      diffs = [`compare failed: ${error.message}`];
    }
    for (const side of SIDES) {
      const r = results[side.name];
      if (!r.pass) failed = true;
      console.log(`${r.pass ? "PASS" : "FAIL"} ${side.name.padEnd(9)} ${check.n}. ${check.name}${r.error ? ` (${r.error})` : ""}`);
    }
    console.log(`${diffs.length ? "DIFF" : "SAME"} ${"".padEnd(9)} ${check.n}. ${check.name}`);
    for (const d of diffs) console.log(`       ${d}`);
    report.checks.push({ n: check.n, name: check.name, same: diffs.length === 0, diffs, ...results });
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2));
console.log(`\nwrote ${join(out, "results.json")}`);
for (const path of written) console.log(`wrote ${path}`);
process.exitCode = failed ? 1 : 0;
