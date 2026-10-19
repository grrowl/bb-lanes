// The client's copy of the turn history: a server snapshot, kept current by
// realtime signals, with the sidebar's live state laid over it. Pure, so the
// merge and overlay rules are unit tested.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { LaneBlock, LaneHandoff, LanesChangedSignal, LanesSnapshot } from "../../../shared/model";
import { laneBlockSchema, laneHandoffSchema } from "../../../shared/schemas";

export interface LanesCache {
  since: number;
  generatedAt: number;
  indexing: boolean;
  blocks: ReadonlyMap<string, LaneBlock>;
  handoffs: ReadonlyMap<string, LaneHandoff>;
}

/** Thread ids to keep, or null for every thread. */
export type ThreadScope = ReadonlySet<string> | null;

function inScope(scope: ThreadScope, threadId: string): boolean {
  return scope === null || scope.has(threadId);
}

function handoffInScope(scope: ThreadScope, handoff: LaneHandoff): boolean {
  return inScope(scope, handoff.fromThreadId) || inScope(scope, handoff.toThreadId);
}

export function cacheFromSnapshot(snapshot: LanesSnapshot, scope: ThreadScope): LanesCache {
  return {
    since: snapshot.since,
    generatedAt: snapshot.generatedAt,
    indexing: snapshot.indexing,
    blocks: new Map(
      snapshot.blocks.filter((block) => inScope(scope, block.threadId)).map((block) => [block.id, block]),
    ),
    handoffs: new Map(
      snapshot.handoffs.filter((handoff) => handoffInScope(scope, handoff)).map((handoff) => [handoff.id, handoff]),
    ),
  };
}

/** Upsert a signal's changes. Returns the same cache when nothing applies. */
export function applySignal(cache: LanesCache, signal: LanesChangedSignal, scope: ThreadScope): LanesCache {
  const blocks = signal.blocks.filter((block) => inScope(scope, block.threadId));
  const handoffs = signal.handoffs.filter((handoff) => handoffInScope(scope, handoff));
  if (blocks.length === 0 && handoffs.length === 0) return cache;
  const nextBlocks = new Map(cache.blocks);
  for (const block of blocks) nextBlocks.set(block.id, block);
  const nextHandoffs = new Map(cache.handoffs);
  for (const handoff of handoffs) nextHandoffs.set(handoff.id, handoff);
  return {
    ...cache,
    generatedAt: Math.max(cache.generatedAt, signal.generatedAt),
    blocks: nextBlocks,
    handoffs: nextHandoffs,
  };
}

const signalSchema = z.object({
  blocks: z.array(laneBlockSchema),
  handoffs: z.array(laneHandoffSchema),
  generatedAt: z.number(),
});

/** Realtime payloads are untrusted; anything malformed reads as "refetch". */
export function parseSignal(payload: unknown): LanesChangedSignal | null {
  const parsed = signalSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** An empty signal means the server could not describe the change: refetch. */
export function isInvalidation(signal: LanesChangedSignal): boolean {
  return signal.blocks.length === 0 && signal.handoffs.length === 0;
}

/** Prefix of blocks the client draws before the server has seen the turn. */
export const PROVISIONAL_PREFIX = "live:";

export function isProvisional(block: LaneBlock): boolean {
  return block.id.startsWith(PROVISIONAL_PREFIX);
}

/** A decision the person just made, shown before the server confirms it. */
export interface DecisionOverride {
  blockId: string;
  /** The interaction that was answered; a new ask on the block ends the override. */
  interactionId: string | null;
  at: number;
}

/**
 * Lay the sidebar's live state over the history so the lanes react the moment
 * bb does, before the server's signal arrives:
 * - a thread with a pending interaction shows its open block waiting;
 * - an open block marked waiting on a thread that is busy again and no longer
 *   asks anything shows running;
 * - a block someone just decided shows running;
 * - a busy thread with no open block gets a provisional one growing from
 *   when it last changed.
 */
export function overlayLiveState(
  blocks: Iterable<LaneBlock>,
  threads: ReadonlyMap<string, PluginSidebarThread>,
  overrides: ReadonlyMap<string, DecisionOverride>,
): LaneBlock[] {
  const result: LaneBlock[] = [];
  const openThreads = new Set<string>();
  const lastEnd = new Map<string, number>();
  for (const block of blocks) {
    let next = block;
    if (block.end === null) {
      openThreads.add(block.threadId);
      const thread = threads.get(block.threadId);
      if (overrides.has(block.id)) {
        next = { ...block, status: "running", ask: null };
      } else if (thread?.hasPendingInteraction === true && block.status === "running") {
        next = { ...block, status: "waiting" };
      } else if (
        block.status === "waiting" &&
        thread !== undefined &&
        !thread.hasPendingInteraction &&
        thread.runtimeStatus === "active"
      ) {
        next = { ...block, status: "running", ask: null };
      }
    } else {
      lastEnd.set(block.threadId, Math.max(lastEnd.get(block.threadId) ?? 0, block.end));
    }
    result.push(next);
  }
  for (const thread of threads.values()) {
    if (openThreads.has(thread.id)) continue;
    const busy = thread.runtimeStatus === "active" || thread.hasPendingInteraction;
    if (!busy || thread.isHidden) continue;
    result.push({
      id: `${PROVISIONAL_PREFIX}${thread.id}`,
      threadId: thread.id,
      start: Math.max(thread.updatedAt, lastEnd.get(thread.id) ?? 0),
      end: null,
      status: thread.hasPendingInteraction ? "waiting" : "running",
      title: "",
      initiator: "user",
      source: "send",
      senderThreadId: null,
      tools: [],
      counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
      ask: null,
    });
  }
  return result;
}

/** Overrides the server has caught up with, or that have gone stale. */
export function settleOverrides(
  overrides: ReadonlyMap<string, DecisionOverride>,
  blocks: ReadonlyMap<string, LaneBlock>,
  now: number,
  maxAgeMs: number,
): Map<string, DecisionOverride> | null {
  let next: Map<string, DecisionOverride> | null = null;
  for (const [blockId, override] of overrides) {
    const block = blocks.get(blockId);
    const settled =
      block === undefined ||
      block.status !== "waiting" ||
      (block.ask?.interactionId ?? null) !== override.interactionId ||
      now - override.at > maxAgeMs;
    if (settled) {
      next ??= new Map(overrides);
      next.delete(blockId);
    }
  }
  return next;
}
