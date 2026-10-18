// Row and block layout for the lanes timeline: row offsets for vertical
// virtualisation, a per-lane block index for time culling, the clustering
// that keeps dense history cheap to draw, the merged activity strip of a
// collapsed group, and hand-off curve endpoints. Pure functions, unit tested.
import type { BlockStatus, LaneBlock, LaneHandoff } from "../../shared/model";
import type { Row, RowDensity } from "../../shared/view";

// ----- Rows -----

export interface RowMetrics {
  lane: number;
  group: number;
  /** Where a lane's blocks are centred, from the lane's top: hand-off lines attach there. */
  laneMid: number;
  /** Half a block's height: a line that lands mid-turn meets the block's edge this far from its middle. */
  blockHalf: number;
}

/**
 * Upstream's rows: 48px with a 28px block, or a 36px compact row. A narrow
 * pane shows avatars only, so each lane gains a caption line above its
 * blocks: 6px, the 14px caption, 2px, then upstream's 28px block and 6px.
 */
export function rowMetrics(density: RowDensity, narrow = false): RowMetrics {
  if (narrow) return { lane: 56, group: 32, laneMid: 36, blockHalf: 14 };
  return density === "compact"
    ? { lane: 36, group: 28, laneMid: 18, blockHalf: 12 }
    : { lane: 48, group: 32, laneMid: 24, blockHalf: 14 };
}

export interface RowLayout {
  rows: Row[];
  tops: number[];
  heights: number[];
  /** Where hand-off lines attach in each row: a lane's block centre, a group row's middle. */
  mids: number[];
  /** Half a block's height, for lines that land on a block's edge. */
  blockHalf: number;
  total: number;
  /** Row index of each visible lane, by thread id. */
  laneRowByThread: Map<string, number>;
  /**
   * Where a thread that has no lane of its own is drawn: the collapsed group
   * or collapsed parent lane that hides it. Hand-off curves end there.
   */
  proxyRowByThread: Map<string, number>;
}

export function layoutRows(rows: Row[], density: RowDensity, narrow = false): RowLayout {
  const metrics = rowMetrics(density, narrow);
  const tops: number[] = new Array(rows.length);
  const heights: number[] = new Array(rows.length);
  const mids: number[] = new Array(rows.length);
  const laneRowByThread = new Map<string, number>();
  const proxyRowByThread = new Map<string, number>();
  const proxyDepth = new Map<string, number>();
  let y = 0;
  rows.forEach((row, index) => {
    const height = row.kind === "group" ? metrics.group : metrics.lane;
    tops[index] = y;
    heights[index] = height;
    mids[index] = y + (row.kind === "group" ? height / 2 : metrics.laneMid);
    y += height;
    if (row.kind === "lane") laneRowByThread.set(row.id, index);
    const hidden =
      row.kind === "group"
        ? row.collapsed
          ? row.threadIds
          : []
        : row.collapsed
          ? (row.collapsedThreadIds ?? [])
          : [];
    // A thread hidden by nested collapsed rows is drawn at the innermost one.
    for (const threadId of hidden) {
      if ((proxyDepth.get(threadId) ?? -1) > row.depth) continue;
      proxyDepth.set(threadId, row.depth);
      proxyRowByThread.set(threadId, index);
    }
  });
  for (const threadId of laneRowByThread.keys()) proxyRowByThread.delete(threadId);
  return { rows, tops, heights, mids, blockHalf: metrics.blockHalf, total: y, laneRowByThread, proxyRowByThread };
}

export function rowKey(row: Row): string {
  return `${row.kind}:${row.id}`;
}

/** Index of a row by id (a lane's thread id or a group's id), or -1. */
export function rowIndexById(layout: RowLayout, id: string): number {
  const lane = layout.laneRowByThread.get(id);
  if (lane !== undefined) return lane;
  return layout.rows.findIndex((r) => r.id === id);
}

/** The row a thread is drawn in, if any: its own lane, else the row that hides it. */
export function rowForThread(layout: RowLayout, threadId: string): { index: number; proxy: boolean } | null {
  const own = layout.laneRowByThread.get(threadId);
  if (own !== undefined) return { index: own, proxy: false };
  const proxy = layout.proxyRowByThread.get(threadId);
  return proxy === undefined ? null : { index: proxy, proxy: true };
}

/** Index of the row containing `y` (clamped to the rows). */
export function rowAtOffset(layout: RowLayout, y: number): number {
  const { tops } = layout;
  if (tops.length === 0) return -1;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Rows intersecting [top, bottom), widened by `overscan` rows each side. */
export function visibleRowRange(
  layout: RowLayout,
  top: number,
  bottom: number,
  overscan: number,
): { first: number; last: number } {
  if (layout.rows.length === 0) return { first: 0, last: -1 };
  const first = Math.max(0, rowAtOffset(layout, top) - overscan);
  const last = Math.min(layout.rows.length - 1, rowAtOffset(layout, Math.max(top, bottom - 1)) + overscan);
  return { first, last };
}

// ----- Block index -----

export interface LaneSeries {
  /** Sorted by start. */
  blocks: LaneBlock[];
  /** Prefix maximum of each block's end (open blocks count as infinite), for binary search. */
  maxEnd: number[];
}

export interface BlockIndex {
  byThread: Map<string, LaneSeries>;
  byId: Map<string, LaneBlock>;
}

export function indexBlocks(blocks: readonly LaneBlock[]): BlockIndex {
  const grouped = new Map<string, LaneBlock[]>();
  const byId = new Map<string, LaneBlock>();
  for (const block of blocks) {
    byId.set(block.id, block);
    const list = grouped.get(block.threadId);
    if (list) list.push(block);
    else grouped.set(block.threadId, [block]);
  }
  const byThread = new Map<string, LaneSeries>();
  for (const [threadId, list] of grouped) {
    list.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    const maxEnd: number[] = new Array(list.length);
    let running = -Infinity;
    list.forEach((block, i) => {
      running = Math.max(running, block.end ?? Infinity);
      maxEnd[i] = running;
    });
    byThread.set(threadId, { blocks: list, maxEnd });
  }
  return { byThread, byId };
}

export function isOpen(block: LaneBlock): boolean {
  return block.end === null;
}

/** Blocks of one lane that overlap [from, to), in start order. */
export function blocksInRange(series: LaneSeries | undefined, from: number, to: number): LaneBlock[] {
  if (!series) return [];
  const { blocks, maxEnd } = series;
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (maxEnd[mid]! > from) hi = mid;
    else lo = mid + 1;
  }
  const out: LaneBlock[] = [];
  for (let i = lo; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (block.start >= to) break;
    if ((block.end ?? Infinity) > from) out.push(block);
  }
  return out;
}

// ----- Track items: blocks and clusters -----

/** Below this a block drops its label. */
export const LABEL_MIN_PX = 28;
/** Done blocks never draw narrower than this. */
export const SLIVER_PX = 6;
/** Small blocks closer than this merge into one cluster. */
export const MERGE_GAP_PX = 6;

export interface BlockItem {
  kind: "block";
  key: string;
  block: LaneBlock;
  start: number;
  /** Drawn end: the block's end, or `openEnd` while it is still open. */
  end: number;
}

export interface ClusterItem {
  kind: "cluster";
  key: string;
  blocks: LaneBlock[];
  start: number;
  end: number;
  /** The most urgent state among the members. */
  status: BlockStatus;
}

export type TrackItem = BlockItem | ClusterItem;

const CLUSTER_PRIORITY: Record<BlockStatus, number> = {
  done: 0,
  interrupted: 1,
  failed: 2,
  running: 3,
  waiting: 4,
};

export function moreUrgent(a: BlockStatus, b: BlockStatus): BlockStatus {
  return CLUSTER_PRIORITY[b] > CLUSTER_PRIORITY[a] ? b : a;
}

export function clusterKey(firstBlockId: string): string {
  return `c:${firstBlockId}`;
}

export function blockKey(blockId: string): string {
  return `b:${blockId}`;
}

/**
 * Turn a lane's blocks into the elements to draw. Blocks too small to read
 * that sit within a few pixels of each other merge into a cluster, so a week
 * of history at full zoom-out costs a handful of elements instead of
 * thousands. Open (running / waiting) blocks always stay individual: they are
 * the ones a person acts on.
 */
export function trackItems(
  blocks: readonly LaneBlock[],
  span: number,
  widthPx: number,
  openEnd: number,
): TrackItem[] {
  const pxPerMs = Math.max(1, widthPx) / span;
  const items: TrackItem[] = [];
  let current: TrackItem | null = null;
  const widthOf = (start: number, end: number) => (end - start) * pxPerMs;
  for (const block of blocks) {
    const open = isOpen(block);
    const end = open ? Math.max(block.start, openEnd) : (block.end as number);
    const small = widthOf(block.start, end) < LABEL_MIN_PX;
    if (current && !open && small && canAbsorb(current, pxPerMs)) {
      const visualEnd = Math.max(current.end, current.start + SLIVER_PX / pxPerMs);
      if ((block.start - visualEnd) * pxPerMs < MERGE_GAP_PX) {
        current = absorb(current, block, end);
        continue;
      }
    }
    if (current) items.push(current);
    current = { kind: "block", key: blockKey(block.id), block, start: block.start, end };
  }
  if (current) items.push(current);
  return items;
}

function canAbsorb(item: TrackItem, pxPerMs: number): boolean {
  if (item.kind === "cluster") return true;
  return !isOpen(item.block) && (item.end - item.start) * pxPerMs < LABEL_MIN_PX;
}

function absorb(item: TrackItem, block: LaneBlock, end: number): ClusterItem {
  if (item.kind === "cluster") {
    item.blocks.push(block);
    item.end = Math.max(item.end, end);
    item.status = moreUrgent(item.status, block.status);
    return item;
  }
  return {
    kind: "cluster",
    key: clusterKey(item.block.id),
    blocks: [item.block, block],
    start: item.start,
    end: Math.max(item.end, end),
    status: moreUrgent(item.block.status, block.status),
  };
}

// ----- Collapsed group: merged activity strip -----

/** Strip states, in rising urgency. 0 means no activity in the bin. */
export const STRIP_STATES: readonly BlockStatus[] = ["done", "interrupted", "failed", "running", "waiting"];

export interface ActivityStrip {
  /** Start time of bin 0 (aligned to a multiple of `binMs`). */
  from: number;
  binMs: number;
  /** Lanes active in each bin. */
  counts: Uint16Array;
  /** Most urgent state per bin: index into STRIP_STATES plus one, or 0. */
  states: Uint8Array;
  maxCount: number;
}

export function activityStrip(
  threadIds: readonly string[],
  index: BlockIndex,
  from: number,
  to: number,
  binMs: number,
  openEnd: number,
): ActivityStrip {
  const start = Math.floor(from / binMs) * binMs;
  const n = Math.max(1, Math.ceil((to - start) / binMs));
  const countDiff = new Int32Array(n + 1);
  const stateDiff = STRIP_STATES.map(() => new Int32Array(n + 1));
  for (const threadId of new Set(threadIds)) {
    for (const block of blocksInRange(index.byThread.get(threadId), start, to)) {
      const end = block.end ?? Math.max(block.start, openEnd);
      const b0 = Math.max(0, Math.floor((block.start - start) / binMs));
      const b1 = Math.min(n, Math.max(b0 + 1, Math.ceil((end - start) / binMs)));
      countDiff[b0]! += 1;
      countDiff[b1]! -= 1;
      const s = STRIP_STATES.indexOf(block.status);
      stateDiff[s]![b0]! += 1;
      stateDiff[s]![b1]! -= 1;
    }
  }
  const counts = new Uint16Array(n);
  const states = new Uint8Array(n);
  const running = STRIP_STATES.map(() => 0);
  let count = 0;
  let maxCount = 0;
  for (let i = 0; i < n; i += 1) {
    count += countDiff[i]!;
    counts[i] = count;
    if (count > maxCount) maxCount = count;
    let state = 0;
    for (let s = 0; s < STRIP_STATES.length; s += 1) {
      running[s]! += stateDiff[s]![i]!;
      if (running[s]! > 0) state = s + 1;
    }
    states[i] = state;
  }
  return { from: start, binMs, counts, states, maxCount };
}

// ----- Hand-off curves -----

export interface CurveEnd {
  /** Time of the endpoint. */
  t: number;
  /** Row the endpoint is drawn in, or null when the thread is not shown. */
  row: number | null;
  proxy: boolean;
  /**
   * The line lands partway into a turn already under way (a child reporting
   * into its parent's running turn), so it meets the block's edge rather than
   * its start.
   */
  midTurn?: boolean;
}

export interface Curve {
  handoff: LaneHandoff;
  from: CurveEnd;
  to: CurveEnd;
  /** The recipient's turn is still going, so the curve flows. */
  live: boolean;
}

/**
 * Curves to draw for the hand-offs overlapping [from, to). A curve starts on
 * the sender's lane at the moment of the hand-off and lands on the target
 * turn. An end whose thread is hidden by a collapsed row lands on that row; an
 * end whose thread is not shown at all becomes a fading stub.
 */
export function handoffCurves(
  handoffs: readonly LaneHandoff[],
  index: BlockIndex,
  layout: RowLayout,
  from: number,
  to: number,
): Curve[] {
  const curves: Curve[] = [];
  for (const handoff of handoffs) {
    const target = index.byId.get(handoff.toBlockId);
    if (!target) continue;
    const source = handoff.fromBlockId ? index.byId.get(handoff.fromBlockId) : undefined;
    // Leave the sender at the moment it happened, inside its turn; land on the
    // target's start, or at that moment when the target was already under way
    // (an ended child reporting into its parent's running turn).
    const t1 = source ? Math.max(source.start, handoff.at) : handoff.at;
    const t2 = Math.max(target.start, t1);
    if (Math.max(t1, t2) < from || Math.min(t1, t2) >= to) continue;
    const a = rowForThread(layout, handoff.fromThreadId);
    const b = rowForThread(layout, handoff.toThreadId);
    if (!a && !b) continue;
    if (a && b && a.index === b.index) continue;
    curves.push({
      handoff,
      from: { t: t1, row: a?.index ?? null, proxy: a?.proxy ?? false },
      to: { t: t2, row: b?.index ?? null, proxy: b?.proxy ?? false, midTurn: t2 > target.start },
      live: target.status === "running" || target.status === "waiting",
    });
  }
  return curves;
}

/** Upstream's least pull on a curve's ends, in viewBox units (tenths of a percent of the track). */
export const MIN_PULL = 24;

/**
 * The path for a hand-off from (x1, y1) to (x2, y2), in the curves' viewBox:
 * x in tenths of a percent of the track, y in px. It is upstream's cubic,
 * `M x1 y1 C x1+s y1, x2-s y2, x2 y2` with `s = max(24, |x2 - x1| / 2)`:
 * horizontal at both ends, so a line leaves its sender heading on and lands
 * on the target's start head-on, where the arrow cap points. A near-instant
 * hand-off (a spawn) becomes a soft S between the two lanes.
 */
export function handoffPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y2 - y1) < 0.5) return `M ${round(x1)} ${round(y1)} H ${round(x2)}`;
  const s = Math.max(MIN_PULL, Math.abs(x2 - x1) / 2);
  return `M ${round(x1)} ${round(y1)} C ${round(x1 + s)} ${round(y1)}, ${round(x2 - s)} ${round(y2)}, ${round(x2)} ${round(y2)}`;
}

/**
 * A line that lands partway into a turn meets the block's top or bottom edge
 * at that moment, arriving upright, so its cap pins the edge instead of
 * covering the title. It leaves the sender as upstream's curve does.
 */
export function edgeLandingPath(x1: number, y1: number, x2: number, yEdge: number): string {
  const s = Math.max(MIN_PULL, Math.abs(x2 - x1) / 2);
  const rise = Math.min(Math.abs(yEdge - y1) / 2, 24) * Math.sign(yEdge - y1);
  return `M ${round(x1)} ${round(y1)} C ${round(x1 + s)} ${round(y1)}, ${round(x2)} ${round(yEdge - rise)}, ${round(x2)} ${round(yEdge)}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
