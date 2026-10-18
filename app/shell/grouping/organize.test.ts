import { describe, expect, it } from "vitest";
import type { GroupRow, LaneRow, Row } from "../../../shared/view";
import { makeBlock, makeProject, makeThread } from "../testing/fixtures";
import { summarizeActivity } from "./lane-state";
import { organizeLanes } from "./organize";
import type { OrganizeInput } from "./types";

const NOW = 1_000_000;

function input(overrides: Partial<OrganizeInput>): OrganizeInput {
  return {
    threads: [],
    projects: [makeProject({ id: "proj_a", name: "alpha" }), makeProject({ id: "proj_b", name: "bravo" })],
    sections: [],
    hosts: [],
    providers: [
      { id: "claude-code", displayName: "Claude Code" },
      { id: "codex", displayName: "Codex" },
    ],
    activity: new Map(),
    mode: "project",
    filter: "all",
    query: "",
    collapsedGroups: new Set(),
    collapsedLanes: new Set(),
    ...overrides,
  };
}

/** Rows as compact strings: "# group" or "  ├ id [state]" by depth. */
function outline(rows: readonly Row[]): string[] {
  return rows.map((row) =>
    row.kind === "group"
      ? `# ${row.label}${row.collapsed ? " (collapsed)" : ""}`
      : `${"  ".repeat(row.depth)}${row.id}${row.state === "idle" ? "" : ` [${row.state}]`}`,
  );
}

describe("organizeLanes: project mode", () => {
  it("groups by the root's project in sidebar order, personal threads last", () => {
    const result = organizeLanes(
      input({
        projects: [
          makeProject({ id: "proj_me", name: "Personal", isPersonal: true }),
          makeProject({ id: "proj_b", name: "bravo" }),
          makeProject({ id: "proj_a", name: "alpha" }),
        ],
        threads: [
          makeThread({ id: "a1", projectId: "proj_a" }),
          makeThread({ id: "me1", projectId: "proj_me" }),
          makeThread({ id: "b1", projectId: "proj_b" }),
          // A child spawned into another project still follows its root.
          makeThread({ id: "b1-child", projectId: "proj_a", parentThreadId: "b1" }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# bravo", "b1", "  b1-child", "# alpha", "a1", "# Threads", "me1"]);
  });

  it("gathers pinned trees into a leading Pinned group", () => {
    const result = organizeLanes(
      input({
        threads: [
          makeThread({ id: "plain" }),
          makeThread({ id: "pinned", pinnedAt: 5 }),
          makeThread({ id: "pinned-child", parentThreadId: "pinned" }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# Pinned", "pinned", "  pinned-child", "# alpha", "plain"]);
  });

  it("drops hidden and archived threads; children of a hidden parent become roots", () => {
    const result = organizeLanes(
      input({
        threads: [
          makeThread({ id: "helper", isHidden: true }),
          makeThread({ id: "orphan", parentThreadId: "helper" }),
          makeThread({ id: "old", isArchived: true, archivedAt: 3 }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "orphan"]);
  });
});

describe("organizeLanes: other modes", () => {
  it("section mode buckets by the root's section with unsectioned threads last", () => {
    const result = organizeLanes(
      input({
        mode: "section",
        sections: [
          { id: "sec_later", name: "Later", createdAt: 1, updatedAt: 1 },
          { id: "sec_now", name: "Now", createdAt: 2, updatedAt: 2 },
        ],
        threads: [
          makeThread({ id: "loose" }),
          makeThread({ id: "now1", sectionId: "sec_now" }),
          makeThread({ id: "later1", sectionId: "sec_later" }),
          makeThread({ id: "later1-child", parentThreadId: "later1", sectionId: "sec_now" }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# Later", "later1", "  later1-child", "# Now", "now1", "# Threads", "loose"]);
  });

  it("machine mode groups each thread by its own host, so a remote child roots its own tree", () => {
    const result = organizeLanes(
      input({
        mode: "machine",
        hosts: [
          { id: "host_cloud", name: "cloud" },
          { id: "host_local", name: "mactom" },
        ],
        threads: [
          makeThread({ id: "lead" }),
          makeThread({ id: "remote", parentThreadId: "lead", host: { id: "host_cloud", name: "cloud" } }),
          makeThread({ id: "local-child", parentThreadId: "lead" }),
          makeThread({ id: "nowhere", host: null }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual([
      "# cloud",
      "remote",
      "# mactom",
      "lead",
      "  local-child",
      "# No machine",
      "nowhere",
    ]);
  });

  it("provider mode follows picker order and carries the provider id for its logo", () => {
    const result = organizeLanes(
      input({
        mode: "provider",
        threads: [makeThread({ id: "gpt", providerId: "codex" }), makeThread({ id: "opus" })],
      }),
    );
    expect(outline(result.rows)).toEqual(["# Claude Code", "opus", "# Codex", "gpt"]);
    expect(result.groups.get("provider:codex")?.providerId).toBe("codex");
  });

  it("environment mode labels by branch and names the project", () => {
    const result = organizeLanes(
      input({
        mode: "environment",
        threads: [
          makeThread({ id: "wt", environment: { id: "env_wt", branchName: "bb/lanes", isWorktree: true } }),
          makeThread({ id: "bare", environment: null }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# bb/lanes", "wt", "# No environment", "bare"]);
    expect(result.groups.get("env:env_wt")).toMatchObject({ detail: "alpha", icon: "GitBranch" });
  });

  it("team mode makes one group per coordinator and pools solo threads", () => {
    const result = organizeLanes(
      input({
        mode: "team",
        threads: [
          makeThread({ id: "solo" }),
          makeThread({ id: "lead", title: "Coordinator" }),
          makeThread({ id: "worker", parentThreadId: "lead" }),
          makeThread({ id: "sub", parentThreadId: "worker" }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# Coordinator", "lead", "  worker", "    sub", "# Solo threads", "solo"]);
  });

  it("none mode emits lanes only", () => {
    const result = organizeLanes(
      input({ mode: "none", threads: [makeThread({ id: "a" }), makeThread({ id: "b", parentThreadId: "a" })] }),
    );
    expect(outline(result.rows)).toEqual(["a", "  b"]);
  });
});

describe("organizeLanes: sort", () => {
  it("puts needs-you first, then running, then most recent activity", () => {
    const result = organizeLanes(
      input({
        threads: [
          makeThread({ id: "old", latestAttentionAt: 10 }),
          makeThread({ id: "recent", latestAttentionAt: 500 }),
          makeThread({ id: "busy", runtimeStatus: "active", status: "active", latestAttentionAt: 1 }),
          makeThread({ id: "blocked", hasPendingInteraction: true, runtimeStatus: "active", latestAttentionAt: 2 }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "blocked [waiting]", "busy [running]", "recent", "old"]);
  });

  it("lifts an idle parent whose child needs you, and uses block history for recency", () => {
    const blocks = [makeBlock({ threadId: "quiet", start: 900, end: 950, status: "done" })];
    const result = organizeLanes(
      input({
        activity: summarizeActivity(blocks, 0, NOW),
        threads: [
          makeThread({ id: "quiet", latestAttentionAt: 1 }),
          makeThread({ id: "lead", latestAttentionAt: 1 }),
          makeThread({ id: "stuck", parentThreadId: "lead", hasPendingInteraction: true }),
          makeThread({ id: "loud", latestAttentionAt: 600 }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "lead", "  stuck [waiting]", "quiet", "loud"]);
  });
});

describe("organizeLanes: filters and search", () => {
  const threads = [
    makeThread({ id: "lead", title: "Plan the release" }),
    makeThread({ id: "worker", title: "Write migration", parentThreadId: "lead", runtimeStatus: "active" }),
    makeThread({ id: "broken", title: "Fix flaky test", status: "error" }),
    makeThread({ id: "asleep", title: "Old idea" }),
    makeThread({ id: "asks", title: "Deploy", hasPendingInteraction: true }),
  ];

  it("Active keeps busy lanes and lanes with a block in the window, plus their ancestors as context", () => {
    const blocks = [makeBlock({ threadId: "asleep", start: NOW - 100, end: NOW - 50, status: "done" })];
    const result = organizeLanes(
      input({ threads, filter: "active", activity: summarizeActivity(blocks, NOW - 1000, NOW) }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "asks [waiting]", "lead", "  worker [running]", "asleep"]);
    expect(result.lanes.get("lead")?.matched).toBe(false);
    expect(result.lanes.get("worker")?.matched).toBe(true);
    expect(result.matchCount).toBe(3);
  });

  it("Needs you and Failed narrow to that state", () => {
    expect(outline(organizeLanes(input({ threads, filter: "needs-you" })).rows)).toEqual(["# alpha", "asks [waiting]"]);
    expect(outline(organizeLanes(input({ threads, filter: "failed" })).rows)).toEqual(["# alpha", "broken [failed]"]);
  });

  it("a latest failed block marks an otherwise idle lane failed", () => {
    const blocks = [makeBlock({ threadId: "asleep", start: 10, end: 20, status: "failed" })];
    const result = organizeLanes(input({ threads, filter: "failed", activity: summarizeActivity(blocks, 0, NOW) }));
    expect(outline(result.rows)).toEqual(["# alpha", "asleep [failed]", "broken [failed]"]);
  });

  it("search matches every term across title, project, model, and branch", () => {
    const blocks = [makeBlock({ threadId: "broken", start: 1, end: 2, status: "failed", model: "claude-opus-5-5" })];
    const activity = summarizeActivity(blocks, 0, NOW);
    expect(outline(organizeLanes(input({ threads, activity, query: "opus 5.5" })).rows)).toEqual([
      "# alpha",
      "broken [failed]",
    ]);
    expect(outline(organizeLanes(input({ threads, activity, query: "MIGRATION" })).rows)).toEqual([
      "# alpha",
      "lead",
      "  worker [running]",
    ]);
    expect(organizeLanes(input({ threads, activity, query: "alpha main" })).matchCount).toBe(5);
    expect(organizeLanes(input({ threads, activity, query: "nothing-like-this" })).rows).toEqual([]);
  });
});

describe("organizeLanes: collapse, counts, and tree guides", () => {
  const threads = [
    makeThread({ id: "lead" }),
    makeThread({ id: "w1", parentThreadId: "lead", runtimeStatus: "active", createdAt: 3 }),
    makeThread({ id: "w1a", parentThreadId: "w1", hasPendingInteraction: true }),
    makeThread({ id: "w2", parentThreadId: "lead", status: "error", createdAt: 2 }),
    makeThread({ id: "other", projectId: "proj_b" }),
  ];

  it("counts every lane in a group, collapsed or not", () => {
    const result = organizeLanes(input({ threads, collapsedGroups: new Set(["project:proj_a"]) }));
    expect(outline(result.rows)).toEqual(["# alpha (collapsed)", "# bravo", "other"]);
    const group = result.rows[0] as GroupRow;
    expect(group.counts).toEqual({ running: 1, waiting: 1, failed: 1, total: 4 });
    expect([...group.threadIds].sort()).toEqual(["lead", "w1", "w1a", "w2"]);
  });

  it("collapsing a lane hides its descendants but keeps hasChildren", () => {
    const result = organizeLanes(input({ threads, collapsedLanes: new Set(["w1"]) }));
    expect(outline(result.rows)).toEqual(["# alpha", "lead", "  w1 [running]", "  w2 [failed]", "# bravo", "other"]);
    const w1 = result.rows.find((row) => row.id === "w1") as LaneRow;
    expect(w1).toMatchObject({ hasChildren: true, collapsed: true, collapsedThreadIds: ["w1a"] });
  });

  it("search reveals matches inside collapsed groups and lanes", () => {
    const result = organizeLanes(
      input({ threads, query: "w1a", collapsedGroups: new Set(["project:proj_a"]), collapsedLanes: new Set(["w1"]) }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "lead", "  w1 [running]", "    w1a [waiting]"]);
  });

  it("marks last children and continues guides through ancestors with later siblings", () => {
    const result = organizeLanes(input({ threads }));
    const lane = (id: string) => result.rows.find((row) => row.id === id) as LaneRow;
    expect(lane("w1").isLastChild).toBe(false);
    expect(lane("w2").isLastChild).toBe(true);
    expect(result.lanes.get("w1a")?.guides).toEqual([true]);
    expect(result.lanes.get("w1")?.guides).toEqual([]);
  });

  it("survives a parent cycle", () => {
    const result = organizeLanes(
      input({
        threads: [
          makeThread({ id: "x", parentThreadId: "y" }),
          makeThread({ id: "y", parentThreadId: "x" }),
        ],
      }),
    );
    expect(outline(result.rows)).toEqual(["# alpha", "x", "y"]);
  });
});
