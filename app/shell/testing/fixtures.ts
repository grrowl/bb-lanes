// Test fixtures for the shell: complete sidebar threads and lane blocks with
// partial overrides, so a new required field changes one default.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LaneBlock } from "../../../shared/model";

type Environment = NonNullable<PluginSidebarThread["environment"]>;

export function makeThread(
  overrides: Partial<Omit<PluginSidebarThread, "environment">> & {
    environment?: Partial<Environment> | null;
  } = {},
): PluginSidebarThread {
  const id = overrides.id ?? "thr_test";
  const projectId = overrides.projectId ?? "proj_a";
  const title = overrides.title === undefined ? `Thread ${id}` : overrides.title;
  const { environment, ...rest } = overrides;
  return {
    id,
    projectId,
    title,
    titleFallback: null,
    displayTitle: title ?? id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: overrides.pinnedAt != null,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    host: { id: "host_local", name: "mactom" },
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...rest,
    environment:
      environment === null
        ? null
        : {
            id: "env_main",
            name: null,
            branchName: "main",
            path: "/repo",
            isWorktree: false,
            providerId: null,
            workspaceDisplayKind: null,
            ...environment,
          },
  };
}

export function makeProject(overrides: Partial<PluginSidebarProject> = {}): PluginSidebarProject {
  const id = overrides.id ?? "proj_a";
  return {
    id,
    name: overrides.name ?? id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
    ...overrides,
  };
}

export function makeBlock(overrides: Partial<LaneBlock> & { threadId: string }): LaneBlock {
  return {
    id: overrides.id ?? `turn_${overrides.threadId}_${overrides.start ?? 0}`,
    start: 0,
    end: null,
    status: "running",
    title: "Do the thing",
    initiator: "user",
    initiatorConfirmed: true,
    source: "send",
    senderThreadId: null,
    tools: [],
    counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
    ask: null,
    ...overrides,
  };
}
