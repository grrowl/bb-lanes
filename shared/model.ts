// Wire model shared by server.ts (producer) and app/ (consumer).
//
// A lane is one bb thread. A block is one agent turn on that thread: it
// starts when the turn starts and ends when the turn completes. Hand-offs are
// the moments one thread caused work on another: a spawn (parent -> child's
// first turn) or a `bb thread tell` (sender -> recipient's turn).
//
// Thread metadata (title, project, section, environment, machine, provider,
// live status, pending interaction) is NOT sent by the server: the frontend
// reads it live from `experimental_useSidebarThreads()`. The server only owns
// the history that the sidebar does not have: turns over time.
//
// All timestamps are epoch milliseconds.

export type BlockStatus =
  /** Turn completed normally. */
  | "done"
  /** Turn started and has not completed. */
  | "running"
  /** Turn is blocked on a person: a pending approval or question. */
  | "waiting"
  /** Turn completed with an error. */
  | "failed"
  /** Turn was stopped or interrupted before it finished. */
  | "interrupted";

/** Who asked for the turn. */
export type BlockInitiator = "user" | "agent" | "system";

/** How the turn's input arrived (bb's `client/turn/requested.source`). Unknown values pass through. */
export type BlockSource = "spawn" | "tell" | "send" | "queue" | "retry" | (string & {});

/** Coarse tool families, drawn as small glyphs before a block's title. */
export type ToolKind =
  | "command"
  | "edit"
  | "tool"
  | "delegation"
  | "web"
  | "mcp"
  | "skill";

export interface BlockAsk {
  interactionId: string;
  /** bb interaction payload kind, e.g. "approval", "user_question". */
  kind: string;
  /** One sentence on what needs deciding (first question prompt / approval title), max ~240 chars. */
  prompt: string;
  /** True when Approve / Reject can be answered inline (an approval with allow/deny). */
  canDecideInline: boolean;
}

export interface LaneBlock {
  /** bb turn id (scope.turnId). Unique across threads. */
  id: string;
  threadId: string;
  start: number;
  /** Null while the turn is open. */
  end: number | null;
  status: BlockStatus;
  /** First line of the input that started the turn, trimmed to ~120 chars. "" when unknown. */
  title: string;
  initiator: BlockInitiator;
  source: BlockSource;
  /** The thread that sent this turn's input (tell from another agent), or null. */
  senderThreadId: string | null;
  /** Distinct tool families used in the turn, most used first, max 3. */
  tools: ToolKind[];
  /** Item counts for the tooltip. */
  counts: {
    commands: number;
    edits: number;
    tools: number;
    delegations: number;
    messages: number;
  };
  /** Present while status is "waiting". */
  ask: BlockAsk | null;
}

export type HandoffKind = "spawn" | "tell";

export interface LaneHandoff {
  /** `${fromThreadId}>${toBlockId}` */
  id: string;
  kind: HandoffKind;
  fromThreadId: string;
  /** The sender's turn that was open at `at`, when known. */
  fromBlockId: string | null;
  toThreadId: string;
  toBlockId: string;
  /** When the hand-off happened (the request time). */
  at: number;
}

export interface LanesSnapshot {
  /** Server clock when the snapshot was cut; use it to correct client clock skew. */
  generatedAt: number;
  /** Lower bound of the window the snapshot covers. */
  since: number;
  /** Every block that overlaps [since, generatedAt]. */
  blocks: LaneBlock[];
  /** Every hand-off whose `at` or target block overlaps the window. */
  handoffs: LaneHandoff[];
  /** True when the server is still backfilling older history. */
  indexing: boolean;
}

/** Lazy detail for one block, fetched when its tooltip opens. */
export interface BlockDetail {
  blockId: string;
  threadId: string;
  /** Two or three short points on what got done (e.g. first sentences of the final agent message). */
  summary: string[];
  /** The full first prompt line(s), up to ~600 chars. */
  prompt: string;
  /** Up to 5 most recent tool items: `{ kind, label }` such as `{ kind: "command", label: "npm test" }`. */
  recent: { kind: ToolKind; label: string }[];
}

/** Realtime channel name and payload. Signals are ephemeral; reconcile on reconnect. */
export const LANES_CHANGED = "lanes-changed";
export interface LanesChangedSignal {
  /** Blocks created or changed since the last signal (bounded, max 50). */
  blocks: LaneBlock[];
  handoffs: LaneHandoff[];
  generatedAt: number;
}
