// Lane jumpers: the ‹ and › at a lane's track edges that zip the window to the
// lane's previous or next turn when nothing of the lane shows on that side.
// Pure functions, unit tested: which turn each button targets, where the
// window lands, and how far away the turn is.
import type { LaneBlock, LaneNeighbors } from "../../shared/model";
import type { LaneSeries } from "./layout";
import { blocksInRange } from "./layout";
import { DAY, HOUR, MINUTE } from "./time";

export interface LaneJumps {
  /** The lane's latest turn that ended before the window, when the window's left half is empty. */
  prev: LaneBlock | null;
  /** The lane's next turn after the window, when not live and the right half is empty. */
  next: LaneBlock | null;
}

export const NO_JUMPS: LaneJumps = { prev: null, next: null };

export interface JumpWindow {
  from: number;
  to: number;
  live: boolean;
}

/** The latest-ending loaded turn that ended at or before `t`. */
function lastEndedBy(series: LaneSeries, t: number): LaneBlock | null {
  const { blocks, maxEnd } = series;
  // maxEnd is a running maximum, so every block before `lo` ended by `t`.
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (maxEnd[mid]! > t) hi = mid;
    else lo = mid + 1;
  }
  if (lo === 0) return null;
  const latest = maxEnd[lo - 1]!;
  for (let i = lo - 1; i >= 0; i -= 1) if (blocks[i]!.end === latest) return blocks[i]!;
  return null;
}

/** The earliest loaded turn that starts after `t`. */
function firstStartingAfter(series: LaneSeries, t: number): LaneBlock | null {
  const { blocks } = series;
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.start > t) hi = mid;
    else lo = mid + 1;
  }
  return blocks[lo] ?? null;
}

/**
 * The jumpers a lane shows for a window. Loaded turns win; the server's
 * neighbours fill in turns older than the loaded history. A button shows
 * only when its half of the window holds none of the lane's turns, so it can
 * never cover one, and there is no next button while live: the right edge is
 * now.
 */
export function laneJumps(series: LaneSeries | undefined, neighbors: LaneNeighbors | undefined, window: JumpWindow): LaneJumps {
  const { from, to, live } = window;
  const mid = from + (to - from) / 2;
  let prev: LaneBlock | null = null;
  if (!series || blocksInRange(series, from, mid).length === 0) {
    prev = (series && lastEndedBy(series, from)) ?? null;
    const older = neighbors?.prev;
    if (!prev && older && older.end !== null && older.end <= from) prev = older;
  }
  let next: LaneBlock | null = null;
  if (!live && (!series || blocksInRange(series, mid, to).length === 0)) {
    next = (series && firstStartingAfter(series, to)) ?? null;
    const later = neighbors?.next;
    if (!next && later && later.start > to) next = later;
  }
  return prev || next ? { prev, next } : NO_JUMPS;
}

/**
 * Where a zip lands: the right edge of the new window, keeping the span. A
 * previous turn lands with its end 70% across, or with its start 10% across
 * when it is too long for that to show its start; a next turn lands with its
 * start 30% across, or 10% when it is longer than the span. A window that
 * reaches now follows the clock again.
 */
export function zipLanding(block: LaneBlock, direction: "prev" | "next", span: number, now: number): { end: number; live: boolean } {
  const end = block.end ?? now;
  const length = end - block.start;
  let windowEnd: number;
  if (direction === "prev") windowEnd = length <= 0.6 * span ? end + 0.3 * span : block.start + 0.9 * span;
  else windowEnd = length > span ? block.start + 0.9 * span : block.start + 0.7 * span;
  return windowEnd >= now ? { end: now, live: true } : { end: windowEnd, live: false };
}

/** How far away a turn is, in one unit: "40m", "3h", "2d". */
export function formatDistance(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (ms < HOUR - MINUTE / 2) return `${minutes}m`;
  if (ms < DAY - HOUR / 2) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

/**
 * The distance a jumper shows: a previous turn by how long ago it ended, a
 * next turn by how long after the window's right edge it starts.
 */
export function jumpDistance(block: LaneBlock, direction: "prev" | "next", windowEnd: number, now: number): string {
  return direction === "prev" ? `${formatDistance(now - (block.end ?? block.start))} ago` : `in ${formatDistance(block.start - windowEnd)}`;
}
