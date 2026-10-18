import { useMemo } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isBusy, laneState } from "../grouping/lane-state";

export interface LiveCounts {
  running: number;
  waiting: number;
  failed: number;
}

/** How many visible threads are working, need someone, or are stuck right now. */
export function countLiveStates(threads: readonly PluginSidebarThread[]): LiveCounts {
  const counts: LiveCounts = { running: 0, waiting: 0, failed: 0 };
  for (const thread of threads) {
    if (thread.isHidden || thread.isArchived) continue;
    const state = laneState(thread, undefined);
    if (state === "waiting") counts.waiting += 1;
    else if (isBusy(state)) counts.running += 1;
    else if (state === "failed") counts.failed += 1;
  }
  return counts;
}

/** Live counts straight from the sidebar, for surfaces that hold no history. */
export function useLiveCounts(): LiveCounts {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => countLiveStates(threads), [threads]);
}
