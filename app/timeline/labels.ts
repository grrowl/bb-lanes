// Copy shared by blocks, tooltips, and screen-reader labels.
import type { BlockStatus, LaneBlock, LaneHandoff } from "../../shared/model";
import { formatClock, formatDuration } from "./time";

export const STATUS_LABEL: Record<BlockStatus, string> = {
  done: "Done",
  running: "Running",
  waiting: "Needs you",
  failed: "Failed",
  interrupted: "Interrupted",
};

type Describe = (threadId: string) => { title: string; subtitle: string | null };

/**
 * The shell draws a provisional block (`live:<threadId>`) for a thread that is
 * busy before the server has reported its turn.
 */
export function isProvisional(block: LaneBlock): boolean {
  return block.id.startsWith("live:");
}

/** What a block says when its input had no text. */
export function blockTitle(block: LaneBlock, describe: Describe): string {
  if (block.title.trim() !== "") return block.title;
  if (isProvisional(block)) return "Working…";
  if (block.source === "spawn") return "Started";
  if (block.senderThreadId) return `Message from ${describe(block.senderThreadId).title}`;
  if (block.initiator === "system") return "Update from bb";
  return "Turn";
}

/**
 * bb starts a turn on a parent when a child finishes or fails, and its input
 * has no prose to title it by. Those turns read "Report from <child>" (or
 * "Reports from 3 threads"), named by their end hand-offs. Every other block
 * is returned as it is.
 */
export function withReportTitles(blocks: readonly LaneBlock[], handoffs: readonly LaneHandoff[], describe: Describe): readonly LaneBlock[] {
  const reporters = new Map<string, Set<string>>();
  for (const handoff of handoffs) {
    if (handoff.kind !== "end") continue;
    const from = reporters.get(handoff.toBlockId) ?? new Set<string>();
    from.add(handoff.fromThreadId);
    reporters.set(handoff.toBlockId, from);
  }
  if (reporters.size === 0) return blocks;
  return blocks.map((block) => {
    const from = reporters.get(block.id);
    if (!from || block.title.trim() !== "") return block;
    const title = from.size === 1 ? `Report from ${describe([...from][0]!).title}` : `Reports from ${from.size} threads`;
    return { ...block, title };
  });
}

export function blockDuration(block: LaneBlock, now: number): number {
  return (block.end ?? now) - block.start;
}

/** "Spec the pane: Draft the index – Done, took 4m, started 2:41 PM" */
export function blockAriaLabel(block: LaneBlock, now: number, describe: Describe): string {
  const lane = describe(block.threadId).title;
  const duration = formatDuration(blockDuration(block, now));
  const timing = block.end === null ? `${duration} so far` : `took ${duration}`;
  return `${lane}: ${blockTitle(block, describe)} – ${STATUS_LABEL[block.status]}, ${timing}, started ${formatClock(block.start)}`;
}

export function clusterAriaLabel(
  threadTitle: string,
  count: number,
  start: number,
  end: number,
  status: BlockStatus,
): string {
  const flagged = status === "failed" ? ", some failed" : status === "interrupted" ? ", some interrupted" : "";
  return `${threadTitle}: ${count} turns from ${formatClock(start)} to ${formatClock(end)}${flagged}. Activate to zoom in.`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
