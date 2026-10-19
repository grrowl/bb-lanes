import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LaneBlock } from "../../../shared/model";
import type { LaneFilter, LaneState, ThreadActivity } from "./types";

/**
 * The lane's own state, from the sidebar's live view first (it updates the
 * moment bb does) and the turn history second. Precedence: someone is needed,
 * then work in progress, then anything stuck before or after it.
 */
export function laneState(
  thread: PluginSidebarThread,
  activity: ThreadActivity | undefined,
): LaneState {
  if (thread.hasPendingInteraction || activity?.openStatus === "waiting") return "waiting";
  switch (thread.runtimeStatus) {
    case "active":
    case "stopping":
      return "running";
    case "starting":
    case "provisioning":
    case "waiting-for-host":
      return "starting";
    case "pending":
      // Held back by the concurrency limit until a slot frees up.
      return "queued";
  }
  if (thread.queuedWork === "waiting") return "queued";
  if (
    thread.status === "error" ||
    thread.queuedWork === "failed" ||
    activity?.lastStatus === "failed"
  ) {
    return "failed";
  }
  return "idle";
}

export function isBusy(state: LaneState): boolean {
  return state === "running" || state === "starting";
}

/** Sort rank: needs-you first, then work in progress, then everything else. */
export function stateRank(state: LaneState): number {
  if (state === "waiting") return 0;
  if (isBusy(state)) return 1;
  return 2;
}

export function matchesFilter(
  filter: LaneFilter,
  state: LaneState,
  activity: ThreadActivity | undefined,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return activity?.inWindow === true || (state !== "idle" && state !== "failed");
    case "needs-you":
      return state === "waiting";
    case "failed":
      return state === "failed";
  }
}

/** Fold blocks into per-thread activity. `windowStart` bounds "in the window". */
export function summarizeActivity(
  blocks: readonly LaneBlock[],
  windowStart: number,
  now: number,
  windowEnd = now,
): Map<string, ThreadActivity> {
  const byThread = new Map<string, ThreadActivity & { lastStart: number; modelAt: number }>();
  for (const block of blocks) {
    const end = block.end ?? now;
    let entry = byThread.get(block.threadId);
    if (entry === undefined) {
      entry = {
        lastActivityAt: 0,
        inWindow: false,
        openStatus: null,
        lastStatus: null,
        model: null,
        lastStart: -Infinity,
        modelAt: -Infinity,
      };
      byThread.set(block.threadId, entry);
    }
    entry.lastActivityAt = Math.max(entry.lastActivityAt, end);
    if (block.start <= windowEnd && end >= windowStart) entry.inWindow = true;
    if (block.end === null && (block.status === "running" || block.status === "waiting")) {
      // A waiting turn outranks a running one if the history briefly holds both.
      if (entry.openStatus !== "waiting") entry.openStatus = block.status;
    }
    if (block.start > entry.lastStart) {
      entry.lastStart = block.start;
      entry.lastStatus = block.status;
    }
    if (block.model && block.start > entry.modelAt) {
      entry.modelAt = block.start;
      entry.model = block.model;
    }
  }
  const result = new Map<string, ThreadActivity>();
  for (const [threadId, entry] of byThread) {
    result.set(threadId, {
      lastActivityAt: entry.lastActivityAt,
      inWindow: entry.inWindow,
      openStatus: entry.openStatus,
      lastStatus: entry.lastStatus,
      model: entry.model,
    });
  }
  return result;
}

/** Lowercased terms of a search query; every term must match. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const lower = haystack.toLowerCase();
  return terms.every((term) => lower.includes(term));
}
