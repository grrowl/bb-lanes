// Standalone harness for the timeline engine: the scripted scenario on an
// accelerated clock, a fake bb theme (light, dark, a custom palette), and the
// shell's tray and card. URL parameters make screenshots reproducible:
//   ?theme=dark&palette=paper&span=1h&density=compact&scenario=stress
//   &elapsed=6&speed=0&width=480&open=k2&empty=1
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LaneBlock } from "../../../shared/model";
import type { Row, RowDensity, Viewport } from "../../../shared/view";
import {
  SCRIPT_MINUTES,
  describeFixture,
  fixtureDetail,
  fixtureRows,
  scenario,
  stressScenario,
  type Fixture,
  type FixtureThread,
  type Provider,
} from "../fixtures";
import { LanesTimeline } from "../LanesTimeline";
import { DAY, HOUR, MINUTE } from "../time";
import { installHarnessRuntime } from "./runtime";
import "./harness.css";

declare const __HARNESS_INTER__: string;

installHarnessRuntime();
if (__HARNESS_INTER__) {
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"Harness Inter";src:url(${__HARNESS_INTER__}) format("woff2");font-weight:100 900;font-display:block}`;
  document.head.append(style);
}

const params = new URLSearchParams(location.search);
const SPANS: Record<string, number> = { "15m": 15 * MINUTE, "1h": HOUR, "4h": 4 * HOUR, "1d": DAY, "7d": 7 * DAY };

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

function Harness() {
  const [theme, setTheme] = useState(params.get("theme") ?? "light");
  const [palette, setPalette] = useState(params.get("palette") ?? "bb");
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
  const [namesWidth, setNamesWidth] = useState(Number(params.get("names") ?? 0) || undefined);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("palette-paper", palette === "paper");
  }, [theme, palette]);

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
  const threads = useMemo(() => new Map(fixture.threads.map((t) => [t.id, t])), [fixture.threads]);
  const describe = useMemo(() => describeFixture(fixture.threads), [fixture.threads]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const onToggleRow = useCallback((row: Row) => {
    if (row.kind === "group") setCollapsedGroups((s) => toggle(s, row.id));
    else setCollapsedLanes((s) => toggle(s, row.id));
  }, []);

  const renderRowHeader = useCallback(
    (row: Row, ctx: { hovered: boolean; focused: boolean }) =>
      row.kind === "group" ? (
        <button type="button" className="hh-group" aria-expanded={!row.collapsed} onClick={() => onToggleRow(row)}>
          <svg className="hh-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 9C18 9 13.58 15 12 15C10.42 15 6 9 6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hh-group-label">{row.label}</span>
          <span className="hh-counts">
            {row.counts.waiting > 0 && <span data-kind="warn">▲ {row.counts.waiting}</span>}
            {row.counts.running > 0 && <span data-kind="run">● {row.counts.running}</span>}
            <span>{row.counts.total}</span>
          </span>
        </button>
      ) : (
        <LaneHeader row={row} thread={threads.get(row.id)} hovered={ctx.hovered} onToggle={() => onToggleRow(row)} />
      ),
    [threads, onToggleRow],
  );

  const onDecide = useCallback(async (block: LaneBlock, decision: "approve" | "reject") => {
    setDecisions((m) => new Map(m).set(block.id, decision));
    setDecidedAt((m) => new Map(m).set(block.id, Date.now()));
  }, []);

  const loadDetail = useCallback(
    (block: LaneBlock) => new Promise<ReturnType<typeof fixtureDetail>>((resolve) => setTimeout(() => resolve(fixtureDetail(block)), 450)),
    [],
  );

  const running = rows.filter((r) => r.kind === "lane" && r.state === "running").length;
  const waiting = rows.filter((r) => r.kind === "lane" && r.state === "waiting").length;
  const width = params.get("width");

  return (
    <div className="hx">
      <div className="hx-bar" hidden={params.get("chrome") === "0"}>
        <strong>Lanes harness</strong>
        <Seg value={which} options={["demo", "stress"]} onChange={setWhich} />
        <Seg value={theme} options={["light", "dark"]} onChange={setTheme} />
        <Seg value={palette} options={["bb", "paper"]} onChange={setPalette} />
        <Seg
          value={Object.entries(SPANS).find(([, v]) => v === viewport.span)?.[0] ?? ""}
          options={Object.keys(SPANS)}
          onChange={(key) => setViewport((v) => ({ ...v, span: SPANS[key]! }))}
        />
        <Seg value={viewport.live ? "live" : "paused"} options={["live"]} onChange={() => setViewport((v) => ({ ...v, live: true }))} />
        <Seg value={density} options={["comfortable", "compact"]} onChange={(d) => setDensity(d as RowDensity)} />
        <span>{Math.round(viewport.span / MINUTE)}m window · {viewport.live ? "live" : "history"}</span>
      </div>
      <div className="hx-stage">
        <div className="hx-tray" style={width ? { flex: `0 0 ${width}px` } : undefined}>
          <div className="hx-card">
            <div className="hx-toolbar">
              <b>Lanes</b>
              <span className="hx-chip">{running} running</span>
              {waiting > 0 && <span className="hx-chip" data-kind="needs">{waiting} need you</span>}
            </div>
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
              highlightedThreadId={params.get("highlight") ?? "thr_engine"}
              namesWidth={namesWidth}
              onNamesWidthChange={setNamesWidth}
              className="hx-timeline"
            />
          </div>
        </div>
      </div>
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

const STATE_LABEL: Partial<Record<string, string>> = { idle: "Idle", waiting: "Needs you", failed: "Failed", queued: "Queued" };

function LaneHeader({
  row,
  thread,
  hovered,
  onToggle,
}: {
  row: Extract<Row, { kind: "lane" }>;
  thread: FixtureThread | undefined;
  hovered: boolean;
  onToggle(): void;
}) {
  const label = STATE_LABEL[row.state];
  const lastLabel = useRef(label ?? "Idle");
  if (label) lastLabel.current = label;
  const step = 22;
  const centre = (depth: number) => 12 + depth * step + 13 - 0.5;
  return (
    <div className="hh" style={{ paddingLeft: 12 + row.depth * step }}>
      {row.depth > 0 && (
        <>
          <span className="hh-guide" style={{ left: centre(row.depth - 1), top: 0, bottom: row.isLastChild ? "50%" : 0, width: 1 }} />
          <span className="hh-guide" style={{ left: centre(row.depth - 1), top: "50%", height: 1, width: step - 15 }} />
        </>
      )}
      {row.hasChildren && !row.collapsed && (
        <span className="hh-guide" style={{ left: centre(row.depth), top: "calc(50% + 13px)", bottom: 0, width: 1 }} />
      )}
      <span className="hh-avatar" onClick={row.hasChildren ? onToggle : undefined} data-hovered={hovered ? "" : undefined}>
        <ProviderLogo provider={thread?.provider ?? "anthropic"} />
      </span>
      <span className="hh-who">
        <span className="hh-line">
          <span className="hh-name">{thread?.title ?? row.id}</span>
          <span className="hh-state" data-show={label ? "" : undefined} data-state={row.state}>
            <span>{lastLabel.current}</span>
          </span>
        </span>
        <span className="hh-sub">
          {thread?.model} · {thread?.branch}
        </span>
      </span>
    </div>
  );
}

/** The reference demo's provider marks, on the white avatar tile. */
function ProviderLogo({ provider }: { provider: Provider }) {
  if (provider === "openai") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: "var(--foreground)" }}>
        <path d={OPENAI_MARK} />
      </svg>
    );
  }
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="hh-gemini" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1C7DFF" />
            <stop offset="0.52" stopColor="#1C69FF" />
            <stop offset="1" stopColor="#B04DFF" />
          </linearGradient>
        </defs>
        <path
          fill="url(#hh-gemini)"
          d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 1200 1200" aria-hidden="true">
      <path fill="#D97757" d={CLAUDE_MARK} />
    </svg>
  );
}

const CLAUDE_MARK = "M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z";
const OPENAI_MARK = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
