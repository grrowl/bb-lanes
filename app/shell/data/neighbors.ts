// The lanes' nearest turns before the loaded history, for the lane jumpers.
// The shell loads every turn from its window's start to now, so a lane's next
// turn is always loaded; only a previous turn older than the history needs
// the server. Asked once the viewport settles, per window, for just the
// lanes that have nothing loaded before the window.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { LaneBlock, LaneNeighbors } from "../../../shared/model";
import type { rpcContract } from "../../../shared/rpc";
import { MINUTE } from "../time";

/** Wait this long after the viewport last moved. */
const SETTLE_MS = 150;
/** Windows remembered, newest last. */
const CACHE_WINDOWS = 24;
/** The RPC's limit on thread ids per call. */
const MAX_THREADS = 500;

export type NeighborsByThread = Readonly<Record<string, LaneNeighbors>>;

/**
 * The lanes whose previous turn is not loaded: no loaded turn ended by the
 * window's start. In the order given, at most `limit` of them.
 */
export function lanesNeedingNeighbors(
  laneIds: readonly string[],
  blocks: readonly LaneBlock[],
  windowStart: number,
  limit = MAX_THREADS,
): string[] {
  const covered = new Set<string>();
  for (const block of blocks) if (block.end !== null && block.end <= windowStart) covered.add(block.threadId);
  return laneIds.filter((id) => !covered.has(id)).slice(0, limit);
}

/**
 * The window start the question is asked from: snapped down to an eighth of
 * the span, so a window sliding with the clock asks again only now and then.
 * Turns between the snapped start and the real one are loaded, and loaded
 * turns win.
 */
export function neighborsFrom(windowStart: number, span: number): number {
  const step = Math.max(MINUTE, span / 8);
  return Math.floor(windowStart / step) * step;
}

export function useLaneNeighbors({
  laneIds,
  blocks,
  windowStart,
  span,
  now,
}: {
  laneIds: readonly string[];
  blocks: readonly LaneBlock[];
  windowStart: number;
  span: number;
  now: number;
}): NeighborsByThread | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const from = neighborsFrom(windowStart, span);
  const wanted = useMemo(() => lanesNeedingNeighbors(laneIds, blocks, windowStart), [laneIds, blocks, windowStart]);
  const key = wanted.length === 0 ? null : `${from}\n${[...wanted].sort().join("\n")}`;
  const cache = useRef(new Map<string, NeighborsByThread>());
  const [result, setResult] = useState<{ key: string; neighbors: NeighborsByThread } | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    if (key === null) return;
    const hit = cache.current.get(key);
    if (hit) {
      setResult({ key, neighbors: hit });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      rpc.call("lanes_neighbors", { threadIds: wanted, from, to: nowRef.current }).then(
        ({ neighbors }) => {
          const store = cache.current;
          store.set(key, neighbors);
          while (store.size > CACHE_WINDOWS) store.delete(store.keys().next().value!);
          if (!cancelled) setResult({ key, neighbors });
        },
        // Without neighbours the jumpers use loaded turns only; the next window asks again.
        () => {},
      );
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `key` encodes `wanted` and `from`.
  }, [key, rpc]);

  // The last answer stays useful while the next is on its way: the engine
  // ignores a neighbour that no longer lies before the window.
  return result?.neighbors;
}
