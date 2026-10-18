// The upstream demo, as Lanes data: the reference's four agents (`_`) and
// seven tasks (`E(now)`) expressed as rows, blocks and one hand-off, so our
// engine and the shell's cells can be compared with the real component side
// by side (`?parity`, and `?parity=live` for its scripted clock).
//
// Upstream's tools are app logos; ours are bb's tool families, mapped by
// what each app does (Google → web, Notion → mcp, GitHub → command, …).
import type { BlockDetail, BlockStatus, LaneBlock, LaneHandoff, ToolKind } from "../../../shared/model";
import type { LaneRow } from "../../../shared/view";
import { MINUTE } from "../time";
import type { LogoProvider } from "./logos";

/** Upstream's frozen clock in `?mode=static`. */
export const PARITY_NOW = Date.UTC(2026, 9, 18, 7, 30);
export const PARITY_SPAN = 30 * MINUTE;
/** Upstream's demo clock runs this many times faster than real time… */
export const PARITY_SPEED = 30;
/** …and starts over after this many demo minutes, unless someone interacted. */
export const PARITY_LOOP_MINUTES = 17;

export interface ParityAgent {
  id: string;
  name: string;
  model: string;
  provider: LogoProvider;
}

export const PARITY_AGENTS: ParityAgent[] = [
  { id: "research", name: "Researcher", model: "Opus 5.5", provider: "anthropic" },
  { id: "writer", name: "Writer", model: "Sonnet 5.5", provider: "anthropic" },
  { id: "review", name: "Reviewer", model: "GPT-6 Sol", provider: "openai" },
  { id: "ops", name: "Ops", model: "Gemini 3.8 Flash", provider: "google" },
];

interface TaskSpec {
  id: string;
  agent: string;
  title: string;
  status: BlockStatus;
  /** Minutes from the demo's start. */
  start: number;
  end?: number;
  tools: ToolKind[];
  summary?: string[];
  ask?: string;
}

const TASKS: TaskSpec[] = [
  {
    id: "r1",
    agent: "research",
    title: "Competitor pricing",
    status: "done",
    start: -27,
    end: -16,
    tools: ["web", "mcp"],
    summary: ["Checked 6 competitors", "Collected plans and prices", "Handed the table to the Writer"],
  },
  {
    id: "r2",
    agent: "research",
    title: "Customer interviews",
    status: "running",
    start: -9,
    tools: ["mcp", "tool"],
    summary: ["Read 14 interview notes", "Grouping quotes by theme"],
  },
  {
    id: "w1",
    agent: "writer",
    title: "Draft pricing page",
    status: "running",
    start: -15,
    tools: ["tool", "mcp"],
    summary: ["Outlined the page", "Wrote plan copy and FAQ"],
  },
  {
    id: "v1",
    agent: "review",
    title: "PR #482 billing",
    status: "done",
    start: -29,
    end: -19,
    tools: ["command", "tool"],
    summary: ["Read 12 changed files", "214 tests passed", "Left 3 comments"],
  },
  {
    id: "v2",
    agent: "review",
    title: "Review pricing copy",
    status: "running",
    start: 4,
    tools: ["tool"],
    summary: ["Checking tone and claims"],
  },
  {
    id: "o1",
    agent: "ops",
    title: "Sync CRM",
    status: "failed",
    start: -27,
    end: -20.5,
    tools: ["tool"],
    summary: ["Loaded 18,240 contacts", "Stopped at the API rate limit"],
  },
  {
    id: "o2",
    agent: "ops",
    title: "Rotate API keys",
    status: "waiting",
    start: -12,
    tools: ["tool", "command"],
    ask: "Rotate the production Stripe and OpenAI keys? Jobs reconnect in ~30 s.",
  },
];

const NO_COUNTS = { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 };

export interface ParityFixture {
  rows: LaneRow[];
  blocks: LaneBlock[];
  handoffs: LaneHandoff[];
  /** Running and waiting tasks, as upstream's bar counts them. */
  counts: { running: number; waiting: number };
}

/**
 * The demo at `elapsed` minutes after `base`. Static (`elapsed` null) is
 * upstream's `?mode=static`: every task as `E(now)` returns it. Live follows
 * the reference demo's script: the Writer finishes at 4 and hands to the
 * Reviewer, Ops is approved at 9 (unless someone decided first), and the
 * Researcher finishes at 13.
 */
export function parityScenario(
  base: number,
  elapsed: number | null,
  decisions: ReadonlyMap<string, { decision: "approve" | "reject"; at: number }> = new Map(),
): ParityFixture {
  const t = (minutes: number) => base + minutes * MINUTE;
  const live = elapsed !== null;
  const tasks = TASKS.flatMap((task): TaskSpec[] => {
    if (!live) return task.id === "v2" ? [] : [task];
    if (task.id === "v2") return elapsed >= 4 ? [task] : [];
    if (task.id === "w1" && elapsed >= 4) return [{ ...task, status: "done", end: 4 }];
    if (task.id === "r2" && elapsed >= 13) return [{ ...task, status: "done", end: 13 }];
    if (task.id === "o2" && !decisions.has("o2") && elapsed >= 9) return [{ ...task, status: "running" }];
    return [task];
  });
  const blocks = tasks.map((task): LaneBlock => {
    const decided = decisions.get(task.id);
    const status: BlockStatus = decided ? (decided.decision === "approve" ? "running" : "failed") : task.status;
    const end = decided?.decision === "reject" ? decided.at : task.end === undefined ? null : t(task.end);
    return {
      id: task.id,
      threadId: task.agent,
      model: null,
      start: t(task.start),
      end,
      status,
      title: task.title,
      initiator: "user",
      source: "send",
      senderThreadId: null,
      tools: task.tools,
      counts: NO_COUNTS,
      ask:
        status === "waiting" && task.ask
          ? { interactionId: `int_${task.id}`, kind: "approval", prompt: task.ask, canDecideInline: true }
          : null,
    };
  });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  // Upstream's `handoffTo`: the curve leaves the sender's end for the next task's start.
  const handoffs: LaneHandoff[] = [];
  for (const [from, to] of [
    ["r1", "w1"],
    ["w1", "v2"],
  ] as const) {
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target || source.end === null) continue;
    handoffs.push({
      id: `${source.threadId}>${to}`,
      kind: "tell",
      fromThreadId: source.threadId,
      fromBlockId: from,
      toThreadId: target.threadId,
      toBlockId: to,
      at: source.end,
    });
  }
  // A lane's tag reads its open task, as upstream's does; static Reviewer
  // counts its not-yet-started review as open, exactly like upstream's.
  const open = (agent: string): LaneRow["state"] | undefined => {
    if (!live && agent === "review") return "running";
    const task = blocks.find((b) => b.threadId === agent && (b.status === "running" || b.status === "waiting"));
    return task?.status === "waiting" ? "waiting" : task ? "running" : undefined;
  };
  const rows = PARITY_AGENTS.map(
    (agent, index): LaneRow => ({
      kind: "lane",
      id: agent.id,
      depth: 0,
      hasChildren: false,
      collapsed: false,
      isLastChild: index === PARITY_AGENTS.length - 1,
      state: open(agent.id) ?? "idle",
    }),
  );
  const running = (live ? blocks : [...blocks, { status: "running" }]).filter((b) => b.status === "running").length;
  const waiting = blocks.filter((b) => b.status === "waiting").length;
  return { rows, blocks, handoffs, counts: { running, waiting } };
}

export function parityDetail(block: LaneBlock): BlockDetail {
  const task = TASKS.find((t) => t.id === block.id);
  return { blockId: block.id, threadId: block.threadId, summary: task?.summary ?? [], prompt: block.title, recent: [] };
}

export function parityDescribe(threadId: string): { title: string; subtitle: string | null } {
  const agent = PARITY_AGENTS.find((a) => a.id === threadId);
  return { title: agent?.name ?? threadId, subtitle: agent?.model ?? null };
}
