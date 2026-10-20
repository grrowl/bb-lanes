// Fixture data for the timeline engine's tests and its standalone harness.
//
// `scenario(base, elapsed)` is a scripted, deterministic picture of a working
// session (like the reference demo's `E()` with its accelerated clock): 13
// lanes in three groups, nested sub-threads, spawn and tell hand-offs, and
// every block state. Advance `elapsed` and turns finish, hand off, and wait.
// `stressScenario` is 200 lanes with a week of history for performance work.
import type { BlockDetail, BlockStatus, LaneBlock, LaneHandoff, ToolKind } from "../../shared/model";
import type { GroupRow, LaneRow, Row } from "../../shared/view";
import { DAY, MINUTE } from "./time";

export type Provider = "anthropic" | "openai" | "google";

export interface FixtureThread {
  id: string;
  title: string;
  model: string;
  provider: Provider;
  branch: string;
  group: string;
  parentId: string | null;
}

export interface FixtureGroup {
  id: string;
  label: string;
}

export interface Fixture {
  groups: FixtureGroup[];
  threads: FixtureThread[];
  blocks: LaneBlock[];
  handoffs: LaneHandoff[];
}

// ----- Building blocks -----

const NO_COUNTS = { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 };

interface BlockSpec {
  initiator?: LaneBlock["initiator"];
  id: string;
  thread: string;
  title: string;
  start: number;
  end?: number | null;
  status?: BlockStatus;
  tools?: ToolKind[];
  source?: string;
  sender?: string | null;
  ask?: { prompt: string; inline: boolean };
}

function block(spec: BlockSpec, threads: Map<string, FixtureThread>): LaneBlock {
  const tools = spec.tools ?? [];
  const status = spec.status ?? (spec.end === undefined || spec.end === null ? "running" : "done");
  const seed = hash(spec.id);
  return {
    id: spec.id,
    threadId: spec.thread,
    model: threads.get(spec.thread)?.model ?? null,
    start: spec.start,
    end: spec.end ?? null,
    status,
    title: spec.title,
    initiator: spec.initiator ?? (spec.sender || spec.source === "spawn" ? "agent" : "user"),
    initiatorConfirmed: true,
    source: spec.source ?? (spec.sender ? "tell" : "send"),
    senderThreadId: spec.sender ?? null,
    tools,
    counts: {
      ...NO_COUNTS,
      commands: tools.includes("command") ? 2 + (seed % 9) : 0,
      edits: tools.includes("edit") ? 1 + (seed % 7) : 0,
      tools: tools.some((t) => t === "tool" || t === "mcp" || t === "web" || t === "skill") ? 1 + (seed % 5) : 0,
      delegations: tools.includes("delegation") ? 1 + (seed % 3) : 0,
      messages: 1 + (seed % 4),
    },
    ask:
      status === "waiting" && spec.ask
        ? {
            interactionId: `int_${spec.id}`,
            kind: spec.ask.inline ? "approval" : "user_question",
            prompt: spec.ask.prompt,
            canDecideInline: spec.ask.inline,
          }
        : null,
  };
}

function handoff(
  kind: LaneHandoff["kind"],
  from: string,
  fromBlock: string | null,
  to: string,
  toBlock: string,
  at: number,
): LaneHandoff {
  return { id: `${from}>${toBlock}`, kind, fromThreadId: from, fromBlockId: fromBlock, toThreadId: to, toBlockId: toBlock, at };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- The scripted scenario -----

export const GROUPS: FixtureGroup[] = [
  { id: "project:bb-lanes", label: "bb-lanes" },
  { id: "project:chillidonut", label: "chillidonut" },
  { id: "project:infra", label: "infra" },
];

export const THREADS: FixtureThread[] = [
  { id: "thr_coord", title: "Coordinate the Lanes build", model: "Opus 5.5", provider: "anthropic", branch: "main", group: "project:bb-lanes", parentId: null },
  { id: "thr_backend", title: "Backend indexer", model: "GPT-6.1 Sol", provider: "openai", branch: "bb/lanes-backend", group: "project:bb-lanes", parentId: "thr_coord" },
  { id: "thr_engine", title: "Timeline engine", model: "Opus 5.5", provider: "anthropic", branch: "bb/lanes-timeline", group: "project:bb-lanes", parentId: "thr_coord" },
  { id: "thr_shell", title: "Shell and grouping", model: "GPT-6.1 Sol", provider: "openai", branch: "bb/lanes-shell", group: "project:bb-lanes", parentId: "thr_coord" },
  { id: "thr_research", title: "Competitor research", model: "Opus 5.5", provider: "anthropic", branch: "pricing", group: "project:chillidonut", parentId: null },
  { id: "thr_writer", title: "Pricing page copy", model: "Sonnet 5.5", provider: "anthropic", branch: "pricing", group: "project:chillidonut", parentId: null },
  { id: "thr_review", title: "Review pricing copy", model: "GPT-6 Sol", provider: "openai", branch: "pricing", group: "project:chillidonut", parentId: null },
  { id: "thr_billing", title: "Billing migration", model: "Sonnet 5.5", provider: "anthropic", branch: "billing-v2", group: "project:chillidonut", parentId: null },
  { id: "thr_keys", title: "Rotate API keys", model: "Gemini 3.8 Flash", provider: "google", branch: "ops", group: "project:chillidonut", parentId: null },
  { id: "thr_evals", title: "Nightly evals", model: "Haiku 5.5", provider: "anthropic", branch: "evals", group: "project:infra", parentId: null },
  { id: "thr_docs", title: "Docs site deploy", model: "Sonnet 5.5", provider: "anthropic", branch: "docs", group: "project:infra", parentId: null },
  { id: "thr_flaky", title: "Flaky test hunt", model: "Opus 5.5", provider: "anthropic", branch: "ci", group: "project:infra", parentId: null },
  { id: "thr_bisect", title: "Bisect the test runner", model: "Haiku 5.5", provider: "anthropic", branch: "ci", group: "project:infra", parentId: "thr_flaky" },
];

/** How long one loop of the script lasts, in fixture minutes. */
export const SCRIPT_MINUTES = 17;

export interface ScenarioOptions {
  /** Decisions a person made on waiting blocks (block id → decision); scripted ones are skipped. */
  decisions?: ReadonlyMap<string, "approve" | "reject">;
  /** When a person decided, so a rejection ends the block there. */
  decidedAt?: ReadonlyMap<string, number>;
  /** Leave out the generated week of older history. */
  noHistory?: boolean;
}

/**
 * The session at `elapsed` minutes into the script. `base` is the clock time
 * the script started; the scenario's history sits before it.
 */
export function scenario(base: number, elapsed: number, options: ScenarioOptions = {}): Fixture {
  const t = (m: number) => base + m * MINUTE;
  const threads = new Map(THREADS.map((th) => [th.id, th]));
  const specs: BlockSpec[] = [];
  const handoffs: LaneHandoff[] = [];
  const at = (m: number) => elapsed >= m;
  const decided = (id: string) => options.decisions?.get(id);
  const decidedTime = (id: string) => options.decidedAt?.get(id) ?? base + elapsed * MINUTE;

  // bb-lanes: a coordinator spawns three workers, who report back with tells.
  specs.push(
    { id: "c1", thread: "thr_coord", title: "Plan the Lanes build", start: t(-44), end: t(-33), tools: ["web", "edit"] },
    { id: "c2", thread: "thr_coord", title: "Write the spec and contracts", start: t(-31), end: t(-18.4), tools: ["edit", "command"] },
    { id: "b1", thread: "thr_backend", title: "Index thread turns and hand-offs", start: t(-18), end: t(-9.2), tools: ["command", "edit"], source: "spawn" },
    { id: "e1", thread: "thr_engine", title: "Build the timeline engine", start: t(-17.6), end: at(14) ? t(14) : null, tools: ["edit", "command", "web"], source: "spawn" },
    { id: "s1", thread: "thr_shell", title: "Group lanes like the sidebar", start: t(-17.1), end: t(-8), tools: ["edit", "command"], source: "spawn" },
    { id: "c3", thread: "thr_coord", title: "Merge the backend and brief the shell", start: t(-8.8), end: t(-5.6), tools: ["command", "delegation"], sender: "thr_backend" },
    { id: "b2", thread: "thr_backend", title: "Answer the coordinator's review notes", start: t(-5.2), end: at(6) ? t(6) : null, tools: ["edit"], sender: "thr_coord" },
  );
  handoffs.push(
    handoff("spawn", "thr_coord", "c2", "thr_backend", "b1", t(-18.6)),
    handoff("spawn", "thr_coord", "c2", "thr_engine", "e1", t(-18.5)),
    handoff("spawn", "thr_coord", "c2", "thr_shell", "s1", t(-18.45)),
    handoff("tell", "thr_backend", "b1", "thr_coord", "c3", t(-9.3)),
    handoff("end", "thr_shell", "s1", "thr_coord", "c3", t(-8)),
    handoff("tell", "thr_coord", "c3", "thr_backend", "b2", t(-5.7)),
  );
  const pushDecision = decided("s2") ?? (at(11) ? "approve" : null);
  specs.push({
    id: "s2",
    thread: "thr_shell",
    title: "Push the shell to main",
    start: t(-3.8),
    end: pushDecision === "reject" ? decidedTime("s2") : at(12.5) && pushDecision ? t(12.5) : null,
    status: pushDecision === "reject" ? "failed" : pushDecision ? (at(12.5) ? "done" : "running") : "waiting",
    tools: ["command"],
    ask: { prompt: "Run `git push origin bb/lanes-shell`? It updates the branch the coordinator merges from.", inline: true },
  });
  if (at(6)) {
    specs.push({ id: "c4", thread: "thr_coord", title: "Merge the review fixes", start: t(6.3), end: at(10) ? t(10) : null, tools: ["command"], sender: "thr_backend" });
    handoffs.push(handoff("tell", "thr_backend", "b2", "thr_coord", "c4", t(6.1)));
  }

  // chillidonut: research hands to the writer, the writer to the reviewer.
  specs.push(
    { id: "r1", thread: "thr_research", title: "Competitor pricing", start: t(-27), end: t(-16), tools: ["web", "tool"] },
    { id: "r2", thread: "thr_research", title: "Customer interviews", start: t(-9), end: at(13) ? t(13) : null, tools: ["mcp", "edit"] },
    { id: "w1", thread: "thr_writer", title: "Draft the pricing page", start: t(-15), end: at(4) ? t(4) : null, tools: ["edit", "skill"], sender: "thr_research" },
    { id: "v1", thread: "thr_review", title: "PR #482 billing", start: t(-29), end: t(-19), tools: ["tool", "command"] },
    { id: "m1", thread: "thr_billing", title: "Run the migration dry run", start: t(-28), end: t(-24.6), status: "failed", tools: ["command"] },
    { id: "m2", thread: "thr_billing", title: "Fix the schema drift", start: t(-23), end: t(-12), tools: ["edit", "command"] },
    { id: "m3", thread: "thr_billing", title: "Re-run the migration", start: t(-3), end: at(13) ? t(13) : null, tools: ["command"] },
    { id: "k1", thread: "thr_keys", title: "Sync the CRM", start: t(-27), end: t(-20.5), status: "failed", tools: ["mcp"] },
  );
  handoffs.push(
    handoff("tell", "thr_research", "r1", "thr_writer", "w1", t(-16.2)),
    handoff("fork", "thr_billing", "m1", "thr_keys", "k1", t(-27.2)),
  );
  if (at(4)) {
    specs.push({ id: "v2", thread: "thr_review", title: "Review the pricing copy", start: t(4.2), end: at(15) ? t(15) : null, tools: ["edit"], sender: "thr_writer" });
    handoffs.push(handoff("tell", "thr_writer", "w1", "thr_review", "v2", t(4)));
  }
  const keysDecision = decided("k2") ?? (at(9) ? "approve" : null);
  specs.push({
    id: "k2",
    thread: "thr_keys",
    title: "Rotate the API keys",
    start: t(-12),
    end: keysDecision === "reject" ? decidedTime("k2") : null,
    status: keysDecision === "reject" ? "failed" : keysDecision ? "running" : "waiting",
    tools: ["tool", "command"],
    ask: { prompt: "Rotate the production Stripe and OpenAI keys? Jobs reconnect in about 30 seconds.", inline: true },
  });

  // infra: a burst of short eval turns (they cluster when zoomed out), an
  // interrupted sweep, and a parent that spawns a bisect.
  for (let i = 0; i < 12; i += 1) {
    const start = -41 + i * 0.62;
    specs.push({ id: `n${i}`, thread: "thr_evals", title: `Eval shard ${i + 1}`, start: t(start), end: t(start + 0.38), tools: ["command"], status: i === 7 ? "failed" : "done" });
  }
  specs.push(
    { id: "n20", thread: "thr_evals", title: "Long eval sweep", start: t(-26), end: t(-14.5), status: "interrupted", tools: ["command", "tool"] },
    { id: "d1", thread: "thr_docs", title: "Build the docs", start: t(-36), end: t(-30.5), tools: ["command"] },
    { id: "d2", thread: "thr_docs", title: "Deploy a preview", start: t(-9), end: t(-7.4), tools: ["command", "web"] },
    { id: "f1", thread: "thr_flaky", title: "Find the flaky test", start: t(-22), end: t(-13.2), tools: ["command", "delegation"] },
    { id: "x1", thread: "thr_bisect", title: "Bisect 40 commits", start: t(-13.6), end: at(15) ? t(15) : null, tools: ["command"], source: "spawn" },
  );
  handoffs.push(handoff("spawn", "thr_flaky", "f1", "thr_bisect", "x1", t(-13.9)));
  if (at(15)) {
    specs.push({ id: "f2", thread: "thr_flaky", title: "Fix the race in the runner", start: t(15.3), end: null, tools: ["edit"], sender: "thr_bisect" });
    handoffs.push(handoff("end", "thr_bisect", "x1", "thr_flaky", "f2", t(15)));
  }
  if (at(9.5)) {
    specs.push({ id: "d3", thread: "thr_docs", title: "Publish the docs", start: t(9.6), end: at(11.5) ? t(11.5) : null, status: "done", tools: ["command"] });
  }

  const now = base + elapsed * MINUTE;
  const blocks = specs.filter((spec) => spec.start <= now).map((spec) => block(spec, threads));
  if (!options.noHistory) {
    const history = generateHistory(THREADS, base - 50 * MINUTE, 7 * DAY, 11);
    blocks.push(...history.blocks);
    handoffs.push(...history.handoffs);
  }
  return { groups: GROUPS, threads: THREADS, blocks, handoffs: handoffs.filter((h) => h.at <= now) };
}

// ----- Generated history -----

const TITLES = [
  "Fix the failing build",
  "Review the open PRs",
  "Refactor the storage layer",
  "Write release notes",
  "Investigate the memory leak",
  "Add tests for the parser",
  "Update dependencies",
  "Tidy the CLI output",
  "Profile the slow query",
  "Port the settings page",
  "Answer the review comments",
  "Draft the migration plan",
  "Triage new issues",
  "Rename the config keys",
  "Bump the SDK and rebuild",
];
const TOOL_SETS: ToolKind[][] = [["command"], ["edit"], ["edit", "command"], ["command", "web"], ["tool"], ["mcp", "edit"], ["delegation", "command"], ["skill"], []];

/**
 * A plausible week of work per thread, ending at `until`: sessions of
 * back-to-back turns separated by idle stretches, mostly done, with the odd
 * failure and interruption. Turns in one thread never overlap. Now and then a
 * turn hands off (a tell) to the next turn of another thread in its group.
 */
export function generateHistory(
  threads: readonly FixtureThread[],
  until: number,
  length: number,
  seed: number,
  turnsPerDay = 14,
): { blocks: LaneBlock[]; handoffs: LaneHandoff[] } {
  const byId = new Map(threads.map((th) => [th.id, th]));
  const lanes = new Map<string, LaneBlock[]>();
  threads.forEach((thread, laneIndex) => {
    const rand = random(seed * 7919 + laneIndex * 104729);
    const turnsPerSession = 3 + rand() * 5;
    const sessionsPerDay = turnsPerDay / turnsPerSession;
    const meanIdle = DAY / sessionsPerDay;
    const list: LaneBlock[] = [];
    let cursor = until - length + rand() * meanIdle;
    let n = 0;
    while (cursor < until) {
      const turns = Math.max(1, Math.round(turnsPerSession * (0.4 + rand() * 1.2)));
      for (let k = 0; k < turns && cursor < until; k += 1) {
        const start = cursor;
        const end = start + (0.4 + rand() ** 2 * 16) * MINUTE;
        cursor = end + (0.1 + rand() ** 3 * 12) * MINUTE;
        if (end >= until) break;
        const roll = rand();
        list.push(
          block(
            {
              id: `h${seed}_${laneIndex}_${n++}`,
              thread: thread.id,
              title: TITLES[Math.floor(rand() * TITLES.length)]!,
              start,
              end,
              status: roll < 0.05 ? "failed" : roll < 0.08 ? "interrupted" : "done",
              tools: TOOL_SETS[Math.floor(rand() * TOOL_SETS.length)]!,
            },
            byId,
          ),
        );
      }
      cursor += meanIdle * (0.3 + rand() * 1.4);
    }
    lanes.set(thread.id, list);
  });

  const handoffs: LaneHandoff[] = [];
  const rand = random(seed * 31 + 7);
  for (const thread of threads) {
    const peers = threads.filter((p) => p.group === thread.group && p.id !== thread.id);
    if (peers.length === 0) continue;
    for (const source of lanes.get(thread.id) ?? []) {
      if (rand() > 0.07) continue;
      const peer = peers[Math.floor(rand() * peers.length)]!;
      const target = (lanes.get(peer.id) ?? []).find(
        (b) => b.start > source.start && b.start - source.start < 30 * MINUTE && b.senderThreadId === null,
      );
      if (!target) continue;
      target.senderThreadId = thread.id;
      target.source = "tell";
      target.initiator = "agent";
      const at = Math.max(source.start, Math.min(source.end ?? target.start, target.start - 4000));
      handoffs.push(handoff("tell", thread.id, source.id, peer.id, target.id, at));
    }
  }
  return { blocks: [...lanes.values()].flat(), handoffs };
}

// ----- Rows -----

export interface RowOptions {
  collapsedGroups?: ReadonlySet<string>;
  collapsedLanes?: ReadonlySet<string>;
}

export function laneState(threadId: string, blocks: readonly LaneBlock[]): LaneRow["state"] {
  let latest: LaneBlock | null = null;
  for (const b of blocks) {
    if (b.threadId !== threadId) continue;
    if (b.end === null) return b.status === "waiting" ? "waiting" : "running";
    if (!latest || b.start > latest.start) latest = b;
  }
  return latest?.status === "failed" ? "failed" : "idle";
}

/** Rows the way the shell builds them: grouped by project, sub-threads nested under parents. */
export function fixtureRows(fixture: Fixture, options: RowOptions = {}): Row[] {
  const rows: Row[] = [];
  const states = new Map(fixture.threads.map((th) => [th.id, laneState(th.id, fixture.blocks)]));
  for (const group of fixture.groups) {
    const members = fixture.threads.filter((th) => th.group === group.id);
    if (members.length === 0) continue;
    const count = (state: LaneRow["state"]) => members.filter((m) => states.get(m.id) === state).length;
    const collapsed = options.collapsedGroups?.has(group.id) ?? false;
    const groupRow: GroupRow = {
      kind: "group",
      id: group.id,
      depth: 0,
      label: group.label,
      collapsed,
      threadIds: members.map((m) => m.id),
      counts: { running: count("running"), waiting: count("waiting"), failed: count("failed"), total: members.length },
    };
    rows.push(groupRow);
    if (collapsed) continue;
    const visit = (thread: FixtureThread, depth: number, isLast: boolean) => {
      const children = members.filter((m) => m.parentId === thread.id);
      const laneCollapsed = options.collapsedLanes?.has(thread.id) ?? false;
      rows.push({
        kind: "lane",
        id: thread.id,
        depth,
        hasChildren: children.length > 0,
        collapsed: laneCollapsed,
        isLastChild: isLast,
        state: states.get(thread.id) ?? "idle",
        collapsedThreadIds: laneCollapsed ? descendants(thread.id, members) : undefined,
      });
      if (laneCollapsed) return;
      children.forEach((child, i) => visit(child, depth + 1, i === children.length - 1));
    };
    const roots = members.filter((m) => !m.parentId || !members.some((p) => p.id === m.parentId));
    roots.forEach((root, i) => visit(root, 0, i === roots.length - 1));
  }
  return rows;
}

function descendants(id: string, members: readonly FixtureThread[]): string[] {
  const out: string[] = [];
  for (const child of members.filter((m) => m.parentId === id)) out.push(child.id, ...descendants(child.id, members));
  return out;
}

export function describeFixture(threads: readonly FixtureThread[]) {
  const byId = new Map(threads.map((th) => [th.id, th]));
  return (threadId: string) => {
    const thread = byId.get(threadId);
    return thread
      ? { title: thread.title, subtitle: `${thread.model} · ${thread.branch}` }
      : { title: "Unknown thread", subtitle: null };
  };
}

// ----- Details -----

const SUMMARIES: Record<string, string[]> = {
  r1: ["Checked 6 competitors", "Collected plans and prices", "Handed the table to the writer"],
  v1: ["Read 12 changed files", "214 tests passed", "Left 3 comments"],
  m1: ["Loaded 18,240 rows", "Stopped at a schema mismatch on invoices.currency"],
  c2: ["Wrote SPEC.md with the pane layout", "Defined the shared contracts", "Spawned three workers"],
  b1: ["Indexed turns from thread events", "Stored blocks in plugin SQLite", "Told the coordinator it is ready"],
  k1: ["Synced 9,120 contacts", "Hit the CRM's API rate limit"],
  c3: ["Merged the backend branch into main", "Ran the full test suite: 132 passed", "Told the shell the RPC contract is final"],
  e1: ["Drew lanes, blocks and hand-off curves", "Wired pan, zoom and keyboard focus", "Screenshots in light and dark"],
};

export function fixtureDetail(block: LaneBlock): BlockDetail {
  const seed = hash(block.id);
  const summary =
    SUMMARIES[block.id] ??
    (block.end === null
      ? ["Working through the plan", "Ran the focused tests"]
      : ["Made the change and checked it", `${10 + (seed % 90)} tests passed`].slice(0, 1 + (seed % 2)));
  const recent: BlockDetail["recent"] = [];
  if (block.tools.includes("command")) recent.push({ kind: "command", label: ["npm test", "git status", "npx tsc --noEmit", "bb plugin build"][seed % 4]! });
  if (block.tools.includes("edit")) recent.push({ kind: "edit", label: ["app/timeline/layout.ts", "server/indexer.ts", "SPEC.md", "pricing/page.mdx"][seed % 4]! });
  if (block.tools.includes("web")) recent.push({ kind: "web", label: "search: usage-based pricing" });
  return { blockId: block.id, threadId: block.threadId, summary, prompt: block.title, recent };
}

// ----- Stress -----

/** 200 lanes in 10 groups with a week of dense history and live work at now. */
export function stressScenario(now: number, lanes = 200, days = 7): Fixture {
  const groups: FixtureGroup[] = Array.from({ length: 10 }, (_, g) => ({ id: `project:stress-${g}`, label: `project-${g + 1}` }));
  const models: [string, Provider][] = [
    ["Opus 5.5", "anthropic"],
    ["Sonnet 5.5", "anthropic"],
    ["GPT-6.1 Sol", "openai"],
    ["Gemini 3.8 Flash", "google"],
  ];
  const threads: FixtureThread[] = Array.from({ length: lanes }, (_, i) => {
    const [model, provider] = models[i % models.length]!;
    return {
      id: `thr_s${i}`,
      title: `${TITLES[i % TITLES.length]} ${Math.floor(i / TITLES.length) + 1}`,
      model,
      provider,
      branch: `work-${i}`,
      group: groups[i % groups.length]!.id,
      parentId: null,
    };
  });
  const history = generateHistory(threads, now - 2 * MINUTE, days * DAY, 3, 40);
  const byId = new Map(threads.map((th) => [th.id, th]));
  const rand = random(99);
  threads.forEach((thread, i) => {
    if (rand() < 0.35) {
      const waiting = rand() < 0.15;
      history.blocks.push(
        block(
          {
            id: `live_${i}`,
            thread: thread.id,
            title: waiting ? "Approve the deploy" : "Keep going",
            start: now - (1 + rand() * 40) * MINUTE,
            end: null,
            status: waiting ? "waiting" : "running",
            tools: ["command", "edit"],
            ask: waiting ? { prompt: "Deploy to production?", inline: true } : undefined,
          },
          byId,
        ),
      );
    }
  });
  return { groups, threads, ...history };
}

