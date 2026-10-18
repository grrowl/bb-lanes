// Rows for the timeline: which lanes exist, in which groups, nested how, in
// which order. Pure so every rule here is unit tested.
//
// The grouping mirrors bb's own sidebar (plugins/thread-list):
// - Children follow their root into its project or section; machine,
//   environment, and provider modes group each thread by its own attribute,
//   so a child on another machine starts a tree of its own there.
// - Pinned threads (and everything under them) gather in a leading "Pinned"
//   group in the modes where the sidebar has one.
// - The personal project's threads, and unsectioned threads, form the
//   trailing "Threads" bucket.
// - Projects, sections, machines, and providers keep the sidebar's order.
// - A thread nests under its parent only when both land in the same group.
//
// Within a group, siblings sort by the most urgent lane in their subtree:
// needs-you first, then running, then most recent activity.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { GroupRow, LaneRow, Row } from "../../../shared/view";
import { formatModelLabel } from "../model-label";
import {
  laneState,
  matchesFilter,
  matchesTerms,
  searchTerms,
  stateRank,
} from "./lane-state";
import type {
  GroupMeta,
  LaneMeta,
  LaneState,
  OrganizeInput,
  Organized,
} from "./types";

const ALL_GROUP: GroupMeta = {
  id: "all",
  kind: "solo",
  label: "All threads",
  detail: null,
  icon: "ListView",
  providerId: null,
};

interface Lane {
  thread: PluginSidebarThread;
  state: LaneState;
  recency: number;
  matched: boolean;
  parentId: string | null;
  group: GroupMeta;
}

interface GroupBucket {
  meta: GroupMeta;
  /** Sidebar order; lower first. Ties fall back to urgency, then label. */
  order: number;
  lanes: Lane[];
}

export function organizeLanes(input: OrganizeInput): Organized {
  const threads = new Map<string, PluginSidebarThread>();
  for (const thread of input.threads) {
    if (thread.isHidden || thread.isArchived) continue;
    threads.set(thread.id, thread);
  }

  // A parent counts only when it is listed and the chain above it does not
  // loop back; a thread in a cycle is treated as a root.
  const parents = new Map<string, PluginSidebarThread | null>();
  for (const thread of threads.values()) {
    let parent = thread.parentThreadId === null ? undefined : threads.get(thread.parentThreadId);
    const seen = new Set<string>([thread.id]);
    for (let at = parent; at !== undefined; ) {
      if (seen.has(at.id)) {
        parent = undefined;
        break;
      }
      seen.add(at.id);
      at = at.parentThreadId === null ? undefined : threads.get(at.parentThreadId);
    }
    parents.set(thread.id, parent ?? null);
  }
  const parentOf = (thread: PluginSidebarThread): PluginSidebarThread | null =>
    parents.get(thread.id) ?? null;

  const rootCache = new Map<string, PluginSidebarThread>();
  const rootOf = (thread: PluginSidebarThread): PluginSidebarThread => {
    const cached = rootCache.get(thread.id);
    if (cached !== undefined) return cached;
    let current = thread;
    for (let parent = parentOf(current); parent !== null; parent = parentOf(current)) {
      current = parent;
    }
    rootCache.set(thread.id, current);
    return current;
  };

  const hasDescendants = new Set<string>();
  for (const thread of threads.values()) {
    const parent = parentOf(thread);
    if (parent !== null) hasDescendants.add(rootOf(parent).id);
  }

  const pinnedCache = new Map<string, boolean>();
  const isPinnedTree = (thread: PluginSidebarThread): boolean => {
    const cached = pinnedCache.get(thread.id);
    if (cached !== undefined) return cached;
    let pinned = false;
    for (let at: PluginSidebarThread | null = thread; at !== null; at = parentOf(at)) {
      if (at.pinnedAt !== null) {
        pinned = true;
        break;
      }
    }
    pinnedCache.set(thread.id, pinned);
    return pinned;
  };

  const projects = new Map(input.projects.map((project, index) => [project.id, { project, index }]));
  const sections = new Map(input.sections.map((section, index) => [section.id, { section, index }]));
  const hostIndex = new Map(input.hosts.map((host, index) => [host.id, index]));
  const providers = new Map(input.providers.map((provider, index) => [provider.id, { provider, index }]));

  const buckets = new Map<string, GroupBucket>();
  const bucket = (meta: GroupMeta, order: number): GroupBucket => {
    let existing = buckets.get(meta.id);
    if (existing === undefined) {
      existing = { meta, order, lanes: [] };
      buckets.set(meta.id, existing);
    }
    return existing;
  };

  const LAST = Number.MAX_SAFE_INTEGER;
  const UNKNOWN = LAST - 1;
  const threadsGroup = (): GroupBucket =>
    bucket(
      { id: "threads", kind: "threads", label: "Threads", detail: null, icon: "MessageSquare", providerId: null },
      LAST,
    );
  const pinnedGroup = (): GroupBucket =>
    bucket({ id: "pinned", kind: "pinned", label: "Pinned", detail: null, icon: "Pin", providerId: null }, -1);

  const assign = (thread: PluginSidebarThread): GroupBucket => {
    const mode = input.mode;
    if ((mode === "project" || mode === "section" || mode === "machine") && isPinnedTree(thread)) {
      return pinnedGroup();
    }
    switch (mode) {
      case "project": {
        const root = rootOf(thread);
        const entry = projects.get(root.projectId);
        if (entry?.project.isPersonal === true) return threadsGroup();
        return bucket(
          {
            id: `project:${root.projectId}`,
            kind: "project",
            label: entry?.project.name ?? "Unknown project",
            detail: null,
            icon: "Folder",
            providerId: null,
          },
          entry?.index ?? UNKNOWN,
        );
      }
      case "section": {
        const sectionId = rootOf(thread).sectionId;
        if (sectionId === null) return threadsGroup();
        const entry = sections.get(sectionId);
        return bucket(
          {
            id: `section:${sectionId}`,
            kind: "section",
            label: entry?.section.name ?? "Section",
            detail: null,
            icon: "Layers",
            providerId: null,
          },
          entry?.index ?? UNKNOWN,
        );
      }
      case "environment": {
        const environment = thread.environment;
        if (environment === null || environment.id === null) {
          return bucket(
            { id: "env:none", kind: "environment", label: "No environment", detail: null, icon: "FolderUnknown", providerId: null },
            LAST,
          );
        }
        const label =
          environment.branchName ?? environment.name ?? basename(environment.path) ?? "Environment";
        const projectName = projects.get(thread.projectId)?.project;
        const detail = projectName === undefined || projectName.isPersonal ? null : projectName.name;
        return bucket(
          {
            id: `env:${environment.id}`,
            kind: "environment",
            label,
            detail: detail === label ? null : detail,
            icon: environment.isWorktree === true ? "GitBranch" : "Folder",
            providerId: null,
          },
          // Environments have no saved order: urgency and recency decide.
          0,
        );
      }
      case "machine": {
        const host = thread.host;
        if (host === null) {
          return bucket(
            { id: "machine:none", kind: "machine", label: "No machine", detail: null, icon: "Unavailable", providerId: null },
            LAST,
          );
        }
        return bucket(
          { id: `machine:${host.id}`, kind: "machine", label: host.name, detail: null, icon: "Laptop", providerId: null },
          hostIndex.get(host.id) ?? UNKNOWN,
        );
      }
      case "provider": {
        const entry = providers.get(thread.providerId);
        return bucket(
          {
            id: `provider:${thread.providerId}`,
            kind: "provider",
            label: entry?.provider.displayName ?? thread.providerId,
            detail: null,
            icon: "Bot",
            providerId: thread.providerId,
          },
          entry?.index ?? UNKNOWN,
        );
      }
      case "team": {
        const root = rootOf(thread);
        if (!hasDescendants.has(root.id)) {
          return bucket(
            { id: "team:solo", kind: "solo", label: "Solo threads", detail: null, icon: "UserRound", providerId: null },
            LAST,
          );
        }
        return bucket(
          { id: `team:${root.id}`, kind: "team", label: root.displayTitle, detail: null, icon: "Workflow", providerId: null },
          0,
        );
      }
      case "none":
        return bucket(ALL_GROUP, 0);
    }
  };

  const searchText = (thread: PluginSidebarThread, model: string | null): string =>
    [
      thread.displayTitle,
      projects.get(thread.projectId)?.project.name,
      thread.sectionId === null ? null : sections.get(thread.sectionId)?.section.name,
      providers.get(thread.providerId)?.provider.displayName,
      model,
      model === null ? null : formatModelLabel(model),
      thread.environment?.branchName,
      thread.environment?.name,
      thread.host?.name,
    ]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join("\n");

  const terms = searchTerms(input.query);
  const searching = terms.length > 0;
  const lanes = new Map<string, Lane>();
  for (const thread of threads.values()) {
    const activity = input.activity.get(thread.id);
    const state = laneState(thread, activity);
    const matched =
      matchesFilter(input.filter, state, activity) &&
      matchesTerms(searchText(thread, activity?.model ?? null), terms);
    const target = assign(thread);
    const lane: Lane = {
      thread,
      state,
      recency: Math.max(activity?.lastActivityAt ?? 0, thread.latestAttentionAt),
      matched,
      parentId: parentOf(thread)?.id ?? null,
      group: target.meta,
    };
    lanes.set(thread.id, lane);
    target.lanes.push(lane);
  }

  const rows: Row[] = [];
  const laneMeta = new Map<string, LaneMeta>();
  const groupMeta = new Map<string, GroupMeta>();
  let matchCount = 0;

  const built: { bucket: GroupBucket; tree: GroupTree }[] = [];
  for (const group of buckets.values()) {
    const tree = buildGroupTree(group, lanes);
    if (tree.included.size === 0) continue;
    built.push({ bucket: group, tree });
  }
  built.sort(
    (a, b) =>
      a.bucket.order - b.bucket.order ||
      a.tree.rank - b.tree.rank ||
      b.tree.recency - a.tree.recency ||
      a.bucket.meta.label.localeCompare(b.bucket.meta.label),
  );

  for (const { bucket: group, tree } of built) {
    const showGroupRow = input.mode !== "none";
    const groupCollapsed = showGroupRow && !searching && input.collapsedGroups.has(group.meta.id);
    if (showGroupRow) {
      groupMeta.set(group.meta.id, group.meta);
      const counts = { running: 0, waiting: 0, failed: 0, total: 0 };
      for (const id of tree.included) {
        const state = lanes.get(id)!.state;
        counts.total += 1;
        if (state === "running" || state === "starting") counts.running += 1;
        else if (state === "waiting") counts.waiting += 1;
        else if (state === "failed") counts.failed += 1;
      }
      const row: GroupRow = {
        kind: "group",
        id: group.meta.id,
        depth: 0,
        label: group.meta.label,
        collapsed: groupCollapsed,
        threadIds: [...tree.included],
        counts,
      };
      rows.push(row);
    }
    for (const id of tree.included) if (lanes.get(id)!.matched) matchCount += 1;
    if (groupCollapsed) continue;

    const emit = (id: string, depth: number, isLastChild: boolean, guides: readonly boolean[]) => {
      const lane = lanes.get(id)!;
      const children = tree.children.get(id) ?? [];
      const collapsed = children.length > 0 && !searching && input.collapsedLanes.has(id);
      const row: LaneRow = {
        kind: "lane",
        id,
        depth,
        hasChildren: children.length > 0,
        collapsed,
        isLastChild,
        state: lane.state,
      };
      rows.push(row);
      laneMeta.set(id, { guides, matched: lane.matched });
      if (collapsed) return;
      const childGuides = depth >= 1 ? [...guides, !isLastChild] : [];
      children.forEach((childId, index) =>
        emit(childId, depth + 1, index === children.length - 1, childGuides),
      );
    };
    tree.roots.forEach((id, index) => emit(id, 0, index === tree.roots.length - 1, []));
  }

  return { rows, groups: groupMeta, lanes: laneMeta, matchCount };
}

interface GroupTree {
  /** Lanes shown in the group: matches plus their in-group ancestors. */
  included: Set<string>;
  roots: string[];
  children: Map<string, string[]>;
  /** Most urgent rank and latest activity across the group. */
  rank: number;
  recency: number;
}

function buildGroupTree(group: GroupBucket, lanes: ReadonlyMap<string, Lane>): GroupTree {
  const members = new Set(group.lanes.map((lane) => lane.thread.id));
  const included = new Set<string>();
  for (const lane of group.lanes) {
    if (!lane.matched) continue;
    // Keep the ancestors that share this group so a match keeps its context.
    for (let at: Lane | undefined = lane; at !== undefined && !included.has(at.thread.id); ) {
      included.add(at.thread.id);
      const parentId = at.parentId;
      at = parentId !== null && members.has(parentId) ? lanes.get(parentId) : undefined;
    }
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of included) {
    const parentId = lanes.get(id)!.parentId;
    if (parentId !== null && included.has(parentId)) {
      const siblings = children.get(parentId);
      if (siblings === undefined) children.set(parentId, [id]);
      else siblings.push(id);
    } else {
      roots.push(id);
    }
  }

  // Subtree urgency so an idle coordinator with a waiting child rises too.
  const subtree = new Map<string, { rank: number; recency: number }>();
  const visiting = new Set<string>();
  const measure = (id: string): { rank: number; recency: number } => {
    const known = subtree.get(id);
    if (known !== undefined) return known;
    const lane = lanes.get(id)!;
    const result = { rank: stateRank(lane.state), recency: lane.recency };
    if (!visiting.has(id)) {
      visiting.add(id);
      for (const childId of children.get(id) ?? []) {
        const child = measure(childId);
        result.rank = Math.min(result.rank, child.rank);
        result.recency = Math.max(result.recency, child.recency);
      }
      visiting.delete(id);
    }
    subtree.set(id, result);
    return result;
  };
  const compare = (a: string, b: string): number => {
    const left = measure(a);
    const right = measure(b);
    const leftThread = lanes.get(a)!.thread;
    const rightThread = lanes.get(b)!.thread;
    return (
      left.rank - right.rank ||
      right.recency - left.recency ||
      rightThread.createdAt - leftThread.createdAt ||
      (a < b ? -1 : a > b ? 1 : 0)
    );
  };
  roots.sort(compare);
  for (const siblings of children.values()) siblings.sort(compare);

  let rank = 2;
  let recency = 0;
  for (const id of roots) {
    const measured = measure(id);
    rank = Math.min(rank, measured.rank);
    recency = Math.max(recency, measured.recency);
  }
  return { included, roots, children, rank, recency };
}

function basename(path: string | null): string | null {
  if (path === null) return null;
  const parts = path.split(/[\\/]/u).filter((part) => part !== "");
  return parts[parts.length - 1] ?? null;
}
