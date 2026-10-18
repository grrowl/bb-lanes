// Standalone harness for the timeline engine, drawn the way bb draws it: the
// shell's tray, bar, card and header cells around `LanesTimeline`, on a fake
// bb runtime. URL parameters make screenshots reproducible:
//   ?theme=dark&span=1h&density=compact&scenario=stress&elapsed=6&speed=0
//   &width=480&collapse=project:infra&empty=1&highlight=thr_engine
// `?parity` draws upstream's demo at upstream's 760px card and frozen clock,
// for side-by-side checks against reference/affectui-agent-lanes/live;
// `?parity=live` runs the demo's accelerated script.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { BlockDetail, LaneBlock } from "../../../shared/model";
import type { GroupRow, LaneRow, Row, RowDensity, Viewport } from "../../../shared/view";
import { LiveSummary } from "../../shell/components/HeaderContent";
import { GroupHeaderCell, LaneHeaderCell, type LaneActions } from "../../shell/components/RowHeader";
import { WindowMenu } from "../../shell/components/Toolbar";
import type { ProviderInfo } from "../../shell/data/useLanesData";
import type { GroupMeta, LaneMeta } from "../../shell/grouping/types";
import { namesColumnWidth } from "../../shell/preferences";
import type { SurfaceActions, SurfaceState } from "../../shell/surface-store";
import { makeThread } from "../../shell/testing/fixtures";
import {
  SCRIPT_MINUTES,
  describeFixture,
  fixtureDetail,
  fixtureRows,
  scenario,
  stressScenario,
  type Fixture,
} from "../fixtures";
import { LanesTimeline } from "../LanesTimeline";
import { DAY, HOUR, MINUTE } from "../time";
import type { LogoProvider } from "./logos";
import {
  PARITY_AGENTS,
  PARITY_LOOP_MINUTES,
  PARITY_NOW,
  PARITY_SPAN,
  PARITY_SPEED,
  parityDescribe,
  parityDetail,
  parityScenario,
} from "./parity";
import { installHarnessRuntime, setHarnessTitles } from "./runtime";
import "../../shell/shell.css";
import "./harness.css";

declare const __HARNESS_INTER__: string;

installHarnessRuntime();
if (__HARNESS_INTER__) {
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"Inter Variable";src:url(${__HARNESS_INTER__}) format("woff2");font-weight:100 900;font-display:block}`;
  document.head.append(style);
}

const params = new URLSearchParams(location.search);
const SPANS: Record<string, number> = { "15m": 15 * MINUTE, "1h": HOUR, "4h": 4 * HOUR, "1d": DAY, "7d": 7 * DAY };
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

// ----- The shell's cells, on fixture threads -----

interface CellThread {
  id: string;
  title: string;
  subtitle: string;
  provider: LogoProvider;
}

const PROVIDER_NAMES: Record<LogoProvider, string> = { anthropic: "Claude", openai: "Codex", google: "Gemini" };

function providerInfo(provider: LogoProvider): ProviderInfo {
  return { id: provider, displayName: PROVIDER_NAMES[provider], logoUrl: null, icon: { glyph: provider } } as unknown as ProviderInfo;
}

/** One avatar-and-elbow per level: which ancestors have later siblings. */
function treeMeta(rows: readonly Row[]): Map<string, LaneMeta> {
  const meta = new Map<string, LaneMeta>();
  const lastAtDepth: boolean[] = [];
  for (const row of rows) {
    if (row.kind !== "lane") continue;
    lastAtDepth[row.depth] = row.isLastChild;
    const guides = row.depth >= 2 ? lastAtDepth.slice(1, row.depth).map((last) => !last) : [];
    meta.set(row.id, { guides, matched: true });
  }
  return meta;
}

const noop = () => {};

function useShellCells(threads: readonly CellThread[], rows: readonly Row[], onToggle: (row: Row) => void) {
  const byId = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);
  const sidebar = useMemo(
    () => new Map(threads.map((t) => [t.id, makeThread({ id: t.id, title: t.title })])),
    [threads],
  );
  useEffect(() => setHarnessTitles(threads.map((t) => [t.id, t.title])), [threads]);
  const meta = useMemo(() => treeMeta(rows), [rows]);
  const actions = useMemo<LaneActions>(
    () => ({
      open: (id, split) => console.info("open", id, { split }),
      toggleGroup: noop,
      toggleLane: (id) => onToggle(rows.find((r) => r.id === id)!),
      setPinned: noop,
      setRead: noop,
      archive: noop,
    }),
    [onToggle, rows],
  );
  return useCallback(
    (row: Row, ctx: { hovered: boolean; focused: boolean }) => {
      if (row.kind === "group") {
        const group: GroupMeta = { id: row.id, kind: "project", label: row.label, detail: null, icon: "Folder", providerId: null };
        return <GroupHeaderCell row={row} meta={group} provider={undefined} onToggle={() => onToggle(row)} />;
      }
      const thread = byId.get(row.id);
      if (!thread) return null;
      return (
        <LaneHeaderCell
          row={row}
          thread={sidebar.get(row.id)!}
          meta={meta.get(row.id)}
          provider={providerInfo(thread.provider)}
          subtitle={thread.subtitle}
          terms={[]}
          highlighted={params.get("highlight") === row.id}
          revealed={ctx.hovered || ctx.focused}
          actions={actions}
        />
      );
    },
    [byId, sidebar, meta, actions, onToggle],
  );
}

/** The window pill, on a stand-in for the surface store. */
function HarnessWindow({ viewport, onChange }: { viewport: Viewport; onChange(next: Viewport): void }) {
  const state = { span: viewport.span, live: viewport.live, end: viewport.end } as SurfaceState;
  const actions = {
    setSpan: (span: number) => onChange({ ...viewport, span }),
    goLive: () => onChange({ ...viewport, live: true }),
  } as SurfaceActions;
  return <WindowMenu state={state} actions={actions} />;
}

/** The tray and its bar; the spark and title stand in for bb's title bar. */
function Tray({
  title,
  counts,
  window,
  className,
  style,
  children,
}: {
  title: string;
  counts: { running: number; waiting: number };
  window: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`bl-theme lanes-chrome lanes-tray ${className ?? ""}`} style={style}>
      <header className="lanes-bar">
        <span className="hx-spark">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
            <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
          </svg>
        </span>
        <span className="hx-title">{title}</span>
        <LiveSummary counts={{ ...counts, failed: 0 }} />
        <span className="lanes-bar-end">{window}</span>
      </header>
      <div className="lanes-card">{children}</div>
    </div>
  );
}

// ----- The scripted scenario and the stress test -----

function useClock(speed: number, startElapsed: number) {
  // The script's clock: `base` is when the script started, `elapsed` runs at `speed`.
  const [base] = useState(() => Date.now() - startElapsed * MINUTE);
  const origin = useRef({ real: Date.now(), fixture: base + startElapsed * MINUTE });
  const [now, setNow] = useState(origin.current.fixture);
  useEffect(() => {
    if (speed === 0) return;
    const timer = window.setInterval(() => {
      setNow(origin.current.fixture + (Date.now() - origin.current.real) * speed);
    }, 250);
    return () => window.clearInterval(timer);
  }, [speed]);
  return { base, now };
}

function DemoHarness() {
  const [density, setDensity] = useState<RowDensity>((params.get("density") as RowDensity) ?? "comfortable");
  const [which, setWhich] = useState(params.get("scenario") ?? "demo");
  const [viewport, setViewport] = useState<Viewport>(() => ({
    end: Date.now(),
    span: SPANS[params.get("span") ?? "15m"] ?? 15 * MINUTE,
    live: true,
  }));
  const speed = Number(params.get("speed") ?? (which === "demo" ? 30 : 1));
  const { base, now } = useClock(speed, Number(params.get("elapsed") ?? 0));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set((params.get("collapse") ?? "").split(",").filter(Boolean)),
  );
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set());
  const [decisions, setDecisions] = useState(() => new Map<string, "approve" | "reject">());
  const [decidedAt, setDecidedAt] = useState(() => new Map<string, number>());
  // The names column the shell would give a pane this wide, until someone drags it.
  const [namesWidth, setNamesWidth] = useState(
    () => Number(params.get("names") ?? 0) || namesColumnWidth(Number(params.get("width") ?? 0) || window.innerWidth - 24, null),
  );

  // The script loops like the reference demo; recompute only when a scripted step is crossed.
  const elapsed = ((now - base) / MINUTE) % (SCRIPT_MINUTES + 1);
  const step = which === "demo" ? Math.floor(elapsed * 10) : 0;
  const stressNow = useMemo(() => Date.now(), []);
  const fixture: Fixture = useMemo(() => {
    if (which === "stress") return stressScenario(stressNow);
    return scenario(base, step / 10, { decisions, decidedAt });
  }, [which, base, step, decisions, decidedAt, stressNow]);

  const empty = params.get("empty") === "1";
  const rows: Row[] = useMemo(
    () => (empty ? [] : fixtureRows(fixture, { collapsedGroups, collapsedLanes })),
    [fixture, collapsedGroups, collapsedLanes, empty],
  );
  const describe = useMemo(() => describeFixture(fixture.threads), [fixture.threads]);
  const threads = useMemo(
    () => fixture.threads.map((t) => ({ id: t.id, title: t.title, subtitle: `${t.model} · ${t.branch}`, provider: t.provider })),
    [fixture.threads],
  );

  const onToggleRow = useCallback((row: Row) => {
    const toggle = (set: Set<string>) => {
      const next = new Set(set);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    };
    if (row.kind === "group") setCollapsedGroups(toggle);
    else setCollapsedLanes(toggle);
  }, []);
  const renderRowHeader = useShellCells(threads, rows, onToggleRow);

  const onDecide = useCallback(async (block: LaneBlock, decision: "approve" | "reject") => {
    setDecisions((m) => new Map(m).set(block.id, decision));
    setDecidedAt((m) => new Map(m).set(block.id, Date.now()));
  }, []);

  const loadDetail = useCallback(
    (block: LaneBlock) => new Promise<BlockDetail>((resolve) => setTimeout(() => resolve(fixtureDetail(block)), 450)),
    [],
  );

  const lanes = rows.filter((r): r is LaneRow => r.kind === "lane");
  const counts = {
    running: lanes.filter((r) => r.state === "running").length,
    waiting: lanes.filter((r) => r.state === "waiting").length,
  };
  const width = params.get("width");

  return (
    <div className="hx">
      <div className="hx-bar" hidden={params.get("chrome") === "0"}>
        <strong>Lanes harness</strong>
        <Seg value={which} options={["demo", "stress"]} onChange={setWhich} />
        <Seg
          value={Object.entries(SPANS).find(([, v]) => v === viewport.span)?.[0] ?? ""}
          options={Object.keys(SPANS)}
          onChange={(key) => setViewport((v) => ({ ...v, span: SPANS[key]! }))}
        />
        <Seg value={density} options={["comfortable", "compact"]} onChange={(d) => setDensity(d as RowDensity)} />
      </div>
      <div className="hx-stage">
        <Tray
          title="Lanes"
          counts={counts}
          window={<HarnessWindow viewport={viewport} onChange={setViewport} />}
          className="hx-pane"
          style={width ? { flex: `0 0 ${width}px` } : undefined}
        >
          <LanesTimeline
            rows={rows}
            blocks={fixture.blocks}
            handoffs={fixture.handoffs}
            now={now}
            viewport={viewport}
            onViewportChange={setViewport}
            density={density}
            renderRowHeader={renderRowHeader}
            onOpenThread={(id, opts) => console.info("open", id, opts)}
            onDecide={onDecide}
            onToggleRow={onToggleRow}
            loadDetail={loadDetail}
            describeThread={describe}
            highlightedThreadId={params.get("highlight")}
            namesWidth={namesWidth}
            onNamesWidthChange={setNamesWidth}
          />
        </Tray>
      </div>
    </div>
  );
}

// ----- Parity with upstream -----

/** Upstream's demo clock: frozen, or accelerated and looping like its `D()`. */
function useParityClock(live: boolean, interacted: boolean) {
  const [base, setBase] = useState(() => (live ? Date.now() : PARITY_NOW));
  const realStart = useRef(Date.now());
  const [now, setNow] = useState(base);
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      const next = base + (Date.now() - realStart.current) * PARITY_SPEED;
      if (!interacted && next - base >= PARITY_LOOP_MINUTES * MINUTE) {
        realStart.current = Date.now();
        setBase(Date.now());
        setNow(Date.now());
      } else {
        setNow(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, base, interacted]);
  return { base, now };
}

function ParityHarness() {
  const live = params.get("parity") === "live";
  const [interacted, setInteracted] = useState(false);
  const { base, now } = useParityClock(live, interacted);
  const [decisions, setDecisions] = useState(() => new Map<string, { decision: "approve" | "reject"; at: number }>());
  const elapsed = live ? Math.floor(((now - base) / MINUTE) * 20) / 20 : null;
  const fixture = useMemo(() => parityScenario(base, elapsed, decisions), [base, elapsed, decisions]);
  const [viewport, setViewport] = useState<Viewport>({ end: PARITY_NOW, span: PARITY_SPAN, live: true });
  const threads = useMemo(
    () => PARITY_AGENTS.map((a) => ({ id: a.id, title: a.name, subtitle: a.model, provider: a.provider })),
    [],
  );
  const renderRowHeader = useShellCells(threads, fixture.rows, noop);
  const nowRef = useRef(now);
  nowRef.current = now;
  const onDecide = useCallback(async (block: LaneBlock, decision: "approve" | "reject") => {
    setDecisions((m) => new Map(m).set(block.id, { decision, at: nowRef.current }));
  }, []);
  const loadDetail = useCallback(async (block: LaneBlock) => parityDetail(block), []);
  // Upstream's demo stops its script for good at the first real interaction.
  const touch = (event: { nativeEvent: Event }) => {
    if (event.nativeEvent.isTrusted) setInteracted(true);
  };
  return (
    <div className="hx-parity" onPointerDownCapture={touch} onKeyDownCapture={touch}>
      <Tray title="Agents" counts={fixture.counts} window={<HarnessWindow viewport={viewport} onChange={setViewport} />}>
        <LanesTimeline
          rows={fixture.rows}
          blocks={fixture.blocks}
          handoffs={fixture.handoffs}
          now={now}
          viewport={viewport}
          onViewportChange={setViewport}
          density="comfortable"
          renderRowHeader={renderRowHeader}
          onOpenThread={(id, opts) => console.info("open", id, opts)}
          onDecide={onDecide}
          onToggleRow={noop}
          loadDetail={loadDetail}
          describeThread={parityDescribe}
          namesWidth={168}
        />
      </Tray>
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange(value: string): void }) {
  return (
    <span className="hx-seg">
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </span>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.has("parity") ? <ParityHarness /> : <DemoHarness />}</StrictMode>,
);
