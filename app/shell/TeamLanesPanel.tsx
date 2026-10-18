import type { ComponentType } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { TimelineProps } from "../../shared/view";
import { LanesPane } from "./LanesPane";

/**
 * Lanes beside one thread: its whole team (the tree from its root down) and
 * the threads it handed work to or from. `params` is ignored on purpose: the
 * panel always reads fresh state for the thread it sits beside.
 */
export function TeamLanesPanel({ threadId, Timeline }: PluginThreadPanelProps & { Timeline: ComponentType<TimelineProps> }) {
  return <LanesPane surface="team-lanes" scope={threadId} teamOf={threadId} Timeline={Timeline} />;
}
