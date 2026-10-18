import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LaneHandoff } from "../../../shared/model";

/**
 * The threads a team panel shows for `threadId`: the whole tree it belongs to
 * (from its root down, so siblings and sub-agents are included) plus every
 * thread it handed work to or received work from.
 */
export function teamThreadIds(
  threadId: string,
  threads: readonly PluginSidebarThread[],
  handoffs: Iterable<LaneHandoff>,
): Set<string> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const siblings = children.get(thread.parentThreadId);
    if (siblings === undefined) children.set(thread.parentThreadId, [thread.id]);
    else siblings.push(thread.id);
  }

  let root = threadId;
  const climbed = new Set<string>([root]);
  for (let parent = byId.get(root)?.parentThreadId; parent != null && byId.has(parent) && !climbed.has(parent); ) {
    climbed.add(parent);
    root = parent;
    parent = byId.get(parent)?.parentThreadId;
  }

  // The thread itself always shows, even before the sidebar lists it.
  const scope = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    scope.add(id);
    for (const child of children.get(id) ?? []) if (!scope.has(child)) stack.push(child);
  }

  scope.add(threadId);
  for (const handoff of handoffs) {
    if (handoff.fromThreadId === threadId) scope.add(handoff.toThreadId);
    if (handoff.toThreadId === threadId) scope.add(handoff.fromThreadId);
  }
  return scope;
}
