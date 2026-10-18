import { describe, expect, it } from "vitest";
import type { LaneBlock, LaneHandoff } from "../../shared/model";
import type { Row } from "../../shared/view";
import {
  CONNECTOR_PX,
  activityStrip,
  blocksInRange,
  handoffCurves,
  handoffPath,
  indexBlocks,
  layoutRows,
  rowForThread,
  STRIP_STATES,
  trackItems,
  visibleRowRange,
} from "./layout";
import { HOUR, MINUTE } from "./time";

const T0 = Date.UTC(2026, 9, 18, 12);
const m = (minutes: number) => T0 + minutes * MINUTE;

function b(id: string, threadId: string, start: number, end: number | null, status: LaneBlock["status"] = end === null ? "running" : "done"): LaneBlock {
  return {
    id,
    threadId,
    start,
    end,
    status,
    title: id,
    initiator: "user",
    source: "send",
    senderThreadId: null,
    tools: [],
    counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
    ask: null,
  };
}

const lane = (id: string, extra: Partial<Extract<Row, { kind: "lane" }>> = {}): Row => ({
  kind: "lane",
  id,
  depth: 0,
  hasChildren: false,
  collapsed: false,
  isLastChild: true,
  state: "idle",
  ...extra,
});
const group = (id: string, threadIds: string[], collapsed = false): Row => ({
  kind: "group",
  id,
  depth: 0,
  label: id,
  collapsed,
  threadIds,
  counts: { running: 0, waiting: 0, failed: 0, total: threadIds.length },
});

describe("rows", () => {
  it("stacks group and lane rows at their heights", () => {
    const layout = layoutRows([group("g", ["a", "b"]), lane("a"), lane("b")], "comfortable");
    expect(layout.tops).toEqual([0, 32, 80]);
    expect(layout.total).toBe(128);
    expect(layoutRows([group("g", []), lane("a")], "compact").total).toBe(28 + 36);
  });

  it("attaches hand-off lines to a lane's blocks and a group's middle", () => {
    const layout = layoutRows([group("g", ["a"]), lane("a")], "comfortable");
    expect(layout.mids).toEqual([16, 32 + 24]);
  });

  it("gives narrow lanes a caption line above upstream's 28px block", () => {
    const layout = layoutRows([group("g", ["a", "b"]), lane("a"), lane("b")], "comfortable", true);
    expect(layout.heights).toEqual([32, 56, 56]);
    // The block runs from 22px to 50px: lines meet its middle, not the row's.
    expect(layout.mids).toEqual([16, 32 + 36, 88 + 36]);
  });

  it("draws hidden threads at the collapsed row that hides them", () => {
    const layout = layoutRows(
      [group("g1", ["a", "b"], true), group("g2", ["p", "c"]), lane("p", { hasChildren: true, collapsed: true, collapsedThreadIds: ["c"] })],
      "comfortable",
    );
    expect(rowForThread(layout, "a")).toEqual({ index: 0, proxy: true });
    expect(rowForThread(layout, "c")).toEqual({ index: 2, proxy: true });
    expect(rowForThread(layout, "p")).toEqual({ index: 2, proxy: false });
    expect(rowForThread(layout, "nowhere")).toBeNull();
  });

  it("virtualises to the rows in view plus overscan", () => {
    const rows = Array.from({ length: 100 }, (_, i) => lane(`t${i}`));
    const layout = layoutRows(rows, "comfortable");
    expect(visibleRowRange(layout, 480, 480 + 480, 2)).toEqual({ first: 8, last: 21 });
    expect(visibleRowRange(layout, 0, 100, 4)).toEqual({ first: 0, last: 6 });
  });
});

describe("block culling", () => {
  const index = indexBlocks([
    b("a1", "a", m(-120), m(-100)),
    b("a2", "a", m(-60), m(-30)),
    b("a3", "a", m(-25), m(-20)),
    b("a4", "a", m(-5), null),
  ]);
  const series = index.byThread.get("a");

  it("draws only blocks that overlap the range", () => {
    expect(blocksInRange(series, m(-40), m(-22)).map((x) => x.id)).toEqual(["a2", "a3"]);
    expect(blocksInRange(series, m(-90), m(-70))).toEqual([]);
  });

  it("keeps open blocks, which reach now", () => {
    expect(blocksInRange(series, m(10), m(20)).map((x) => x.id)).toEqual(["a4"]);
  });

  it("finds long blocks that started well before the range", () => {
    const long = indexBlocks([b("x", "a", m(-600), m(0)), b("y", "a", m(-10), m(-9))]).byThread.get("a");
    expect(blocksInRange(long, m(-30), m(-20)).map((x) => x.id)).toEqual(["x"]);
  });
});

describe("clusters", () => {
  // 15 minutes across 900px: 1px per second.
  const span = 15 * MINUTE;
  const width = 900;
  const s = (seconds: number) => T0 + seconds * 1000;

  it("merges small neighbouring blocks into one cluster", () => {
    const blocks = [b("1", "a", s(0), s(10)), b("2", "a", s(12), s(20)), b("3", "a", s(22), s(30), "failed")];
    const items = trackItems(blocks, span, width, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "cluster", key: "c:1", status: "failed", start: s(0), end: s(30) });
  });

  it("keeps readable blocks apart, even when close", () => {
    const blocks = [b("1", "a", s(0), s(100)), b("2", "a", s(102), s(200))];
    expect(trackItems(blocks, span, width, 0).map((i) => i.kind)).toEqual(["block", "block"]);
  });

  it("never swallows an open block", () => {
    const blocks = [b("1", "a", s(0), s(5)), b("2", "a", s(7), null)];
    const items = trackItems(blocks, span, width, s(10));
    expect(items.map((i) => i.key)).toEqual(["b:1", "b:2"]);
    expect(items[1]!.end).toBe(s(10));
  });

  it("leaves well-separated slivers alone", () => {
    const blocks = [b("1", "a", s(0), s(2)), b("2", "a", s(60), s(62))];
    expect(trackItems(blocks, span, width, 0)).toHaveLength(2);
  });
});

describe("collapsed group strip", () => {
  it("counts busy lanes per bin and keeps the most urgent state", () => {
    const index = indexBlocks([
      b("a", "t1", m(0), m(10)),
      b("b", "t2", m(5), m(10), "failed"),
      b("c", "t3", m(8), null, "waiting"),
    ]);
    const strip = activityStrip(["t1", "t2", "t3"], index, m(0), m(12), MINUTE, m(12));
    expect(Array.from(strip.counts)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 1, 1]);
    const state = (i: number) => STRIP_STATES[strip.states[i]! - 1];
    expect(state(0)).toBe("done");
    expect(state(6)).toBe("failed");
    expect(state(9)).toBe("waiting");
    expect(strip.maxCount).toBe(3);
  });
});

describe("hand-off curves", () => {
  const blocks = [b("p1", "p", m(-30), m(-10)), b("c1", "c", m(-20), null), b("x1", "x", m(-15), m(-5))];
  const index = indexBlocks(blocks);
  const handoff = (id: string, from: string, fromBlock: string | null, to: string, toBlock: string, at: number): LaneHandoff => ({
    id,
    kind: "spawn",
    fromThreadId: from,
    fromBlockId: fromBlock,
    toThreadId: to,
    toBlockId: toBlock,
    at,
  });
  const handoffs = [handoff("h1", "p", "p1", "c", "c1", m(-21)), handoff("h2", "p", "p1", "x", "x1", m(-16))];

  it("joins the hand-off moment to the start of the recipient's turn", () => {
    const layout = layoutRows([lane("p"), lane("c"), lane("x")], "comfortable");
    const curves = handoffCurves(handoffs, index, layout, m(-60), m(0));
    expect(curves[0]).toMatchObject({ from: { t: m(-21), row: 0 }, to: { t: m(-20), row: 1 }, live: true });
    expect(curves[1]).toMatchObject({ live: false });
  });

  it("ends at a collapsed row, and fades out when the thread is not shown", () => {
    const layout = layoutRows([lane("p"), group("g", ["c"], true)], "comfortable");
    const curves = handoffCurves(handoffs, index, layout, m(-60), m(0));
    expect(curves[0]).toMatchObject({ to: { row: 1, proxy: true } });
    expect(curves[1]).toMatchObject({ to: { row: null } });
  });

  it("leaves the sender inside its turn and lands mid-turn on a target already under way", () => {
    const parent = b("p2", "p", m(-40), null);
    const child = b("c2", "c", m(-30), m(-12));
    const ended: LaneHandoff = { ...handoff("e", "c", "c2", "p", "p2", m(-12)), kind: "end" };
    const layout = layoutRows([lane("p"), lane("c")], "comfortable");
    const [curve] = handoffCurves([ended], indexBlocks([parent, child]), layout, m(-60), m(0));
    expect(curve).toMatchObject({ from: { t: m(-12), row: 1 }, to: { t: m(-12), row: 0 }, live: true });
  });

  it("skips curves inside one row and outside the range", () => {
    const layout = layoutRows([group("g", ["p", "c", "x"], true)], "comfortable");
    expect(handoffCurves(handoffs, index, layout, m(-60), m(0))).toEqual([]);
    const lanes = layoutRows([lane("p"), lane("c"), lane("x")], "comfortable");
    expect(handoffCurves(handoffs, index, lanes, m(-2 * HOUR / MINUTE), m(-40))).toEqual([]);
  });
});

describe("hand-off paths", () => {
  // 1000 units across a 1000px track: one unit per pixel.
  const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

  it("draws the reference's cubic when the ends are far apart", () => {
    const d = handoffPath(100, 24, 300, 72, 1);
    expect(d).toBe("M 100 24 C 200 24, 200 72, 300 72");
  });

  it("pulls short curves at least 24px", () => {
    expect(handoffPath(100, 24, 140, 72, 1)).toBe("M 100 24 C 124 24, 116 72, 140 72");
  });

  it("turns near-instant hand-offs into a connector with rounded elbows", () => {
    const d = handoffPath(100, 24, 110, 72, 1);
    expect(d.startsWith("M 100 24 V 64 Q 100 72, 108 72")).toBe(true);
    expect(d.endsWith("H 110")).toBe(true);
    expect(110 - 100).toBeLessThan(CONNECTOR_PX);
  });

  it("runs the connector just left of a target that starts at the same moment", () => {
    const d = handoffPath(100, 24, 100, 120, 1);
    const [x0, y0] = numbers(d);
    expect([x0, y0]).toEqual([100, 24]);
    // Left of the target by one elbow radius, arriving horizontally on its start.
    expect(d).toContain("V 112");
    expect(d.endsWith("Q 92 120, 100 120")).toBe(true);
  });

  it("goes up as well as down", () => {
    expect(handoffPath(100, 120, 110, 24, 1)).toContain("V 32 Q 100 24, 108 24");
  });

  it("keeps elbows round on a stretched SVG", () => {
    // Two units per pixel: horizontal radius doubles in units, vertical stays 8px.
    expect(handoffPath(200, 24, 220, 72, 2)).toContain("V 64 Q 200 72, 216 72");
  });
});
