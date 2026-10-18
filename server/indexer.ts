import type { BlockAsk, BlockInitiator, LaneBlock, LaneHandoff, ToolKind } from "../shared/model";

/** Deliberately structural: providers may add fields and event kinds independently. */
export interface IndexEvent {
  seq: number;
  createdAt: number;
  type: string;
  scope: { kind: string; turnId?: string };
  data: unknown;
}
export interface IndexThread {
  id: string;
  parentThreadId: string | null;
  status: string;
  updatedAt: number;
  title?: string | null;
  projectId?: string;
}
interface InputRequest {
  id: string;
  at: number;
  prompt: string;
  model: string | null;
  source: string;
  initiator: BlockInitiator;
  senderThreadId: string | null;
  assignedTo: string | null;
}
export interface IndexedTurn {
  block: LaneBlock;
  prompt: string;
  startSeq: number;
  endSeq: number | null;
  acceptedRequestIds: string[];
  fallbackRequestId: string | null;
  toolFrequency: Partial<Record<ToolKind, number>>;
  seenItems: string[];
  pending: Record<string, BlockAsk>;
  syntheticEnd: boolean;
}
/** Bump whenever folding changes what a block holds; stored indexes from older versions are rebuilt. */
export const INDEX_VERSION = 2;

export interface ThreadIndex {
  version: number;
  lastSeq: number;
  requests: InputRequest[];
  turns: Record<string, IndexedTurn>;
  handoffs: LaneHandoff[];
  removedTurnIds: string[];
}
export const INDEX_EVENT_TYPES = [
  "turn/started", "turn/completed", "client/turn/requested", "turn/input/accepted",
  "system/interaction/lifecycle", "system/operation", "item/started",
] as const;

export const emptyIndex = (): ThreadIndex => ({
  version: INDEX_VERSION, lastSeq: 0, requests: [], turns: {}, handoffs: [], removedTurnIds: [],
});
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export const string = (value: unknown): string => typeof value === "string" ? value : "";
export function promptText(input: unknown): string {
  return Array.isArray(input)
    ? input.map(part => string(object(part).text)).filter(Boolean).join("\n") : "";
}
export function toolKind(item: Record<string, unknown>): ToolKind | null {
  switch (item.type) {
    case "commandExecution": return "command";
    case "fileChange": return "edit";
    case "delegation": return "delegation";
    case "webSearch": case "webFetch": return "web";
    case "mcpToolCall": return "mcp";
    case "toolCall": {
      const tool = string(item.tool).toLowerCase();
      if (tool === "skill" || tool.endsWith("__skill")) return "skill";
      if (tool.startsWith("mcp") || item.server) return "mcp";
      if (/web.?search|web.?fetch|^web[._]/.test(tool)) return "web";
      return "tool";
    }
    default: return null;
  }
}
export function inlineApproval(payload: Record<string, unknown>): boolean {
  return payload.kind === "approval" && Array.isArray(payload.availableDecisions)
    && payload.availableDecisions.includes("allow_once") && payload.availableDecisions.includes("deny");
}
export function askFromInteraction(interaction: Record<string, unknown>): BlockAsk {
  const payload = object(interaction.payload);
  const subject = object(payload.subject);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const prompt = string(object(questions[0]).prompt) || string(payload.title)
    || string(payload.reason) || string(subject.command) || string(subject.toolName)
    || (subject.kind === "file_change" ? "Allow these file changes?" : "Review this request in the thread");
  return { interactionId: string(interaction.id), kind: string(payload.kind),
    prompt: prompt.slice(0, 240), canDecideInline: inlineApproval(payload) };
}
function updateWaiting(turn: IndexedTurn) {
  turn.block.ask = Object.values(turn.pending).at(-1) ?? null;
  if (turn.block.end === null) turn.block.status = turn.block.ask ? "waiting" : "running";
}
function addHandoff(state: ThreadIndex, thread: IndexThread, turn: IndexedTurn, request: InputRequest) {
  const from = request.source === "tell" ? request.senderThreadId
    : request.source === "spawn" ? thread.parentThreadId : null;
  if (!from || from === thread.id) return;
  const id = `${from}>${turn.block.id}`;
  if (state.handoffs.some(handoff => handoff.id === id)) return;
  state.handoffs.push({ id, kind: request.source === "spawn" ? "spawn" : "tell",
    fromThreadId: from, fromBlockId: null, toThreadId: thread.id,
    toBlockId: turn.block.id, at: request.at });
}
const ENVELOPE_LINE = /^\[bb [^\]]*\]$/;
const MARKDOWN_PREFIX = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/;

/**
 * A block's title: the first line of the prompt that reads as prose. bb wraps
 * relayed messages in a "[bb message from thread:…]" envelope line and agents
 * write markdown, so skip envelopes, rules, and fences, and drop list, quote,
 * heading, and emphasis markers.
 */
export function promptTitle(prompt: string): string {
  for (const raw of prompt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || ENVELOPE_LINE.test(line) || /^(?:-{3,}|\*{3,}|_{3,}|`{3}.*)$/.test(line)) continue;
    const text = line.replace(MARKDOWN_PREFIX, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length <= 120) return text;
    const cut = text.slice(0, 119);
    const space = cut.lastIndexOf(" ");
    return `${space > 80 ? cut.slice(0, space) : cut}…`;
  }
  return "";
}

function applyRequest(turn: IndexedTurn, request: InputRequest) {
  turn.prompt = request.prompt;
  turn.block.title = promptTitle(request.prompt);
  turn.block.model = request.model;
  turn.block.source = request.source;
  turn.block.initiator = request.initiator;
  turn.block.senderThreadId = request.senderThreadId;
}

/** Incremental and deterministic. Persist the returned state, including unaccepted requests. */
export function foldEvents(previous: ThreadIndex, events: readonly IndexEvent[], thread: IndexThread): ThreadIndex {
  const state = structuredClone(previous);
  for (const event of events) {
    if (event.seq <= state.lastSeq) continue;
    state.lastSeq = event.seq;
    const data = object(event.data);
    if (event.type === "system/operation") {
      const removed = string(object(data.metadata).removedTurnId);
      if (removed) {
        delete state.turns[removed];
        if (!state.removedTurnIds.includes(removed)) state.removedTurnIds.push(removed);
        state.handoffs = state.handoffs.filter(handoff => handoff.toBlockId !== removed);
      }
      continue;
    }
    if (event.type === "client/turn/requested") {
      const id = string(data.requestId) || `seq:${event.seq}`;
      if (!state.requests.some(request => request.id === id)) {
        state.requests.push({ id, at: event.createdAt, prompt: promptText(data.input).slice(0, 600),
          model: string(object(data.execution).model) || string(data.model) || null,
          source: string(data.source) || "send", initiator: data.initiator === "agent" || data.initiator === "system" ? data.initiator : "user",
          senderThreadId: string(data.senderThreadId) || null, assignedTo: null });
      }
      continue;
    }
    const turnId = event.scope.turnId;
    if (!turnId || state.removedTurnIds.includes(turnId)) continue;
    if (event.type === "turn/started" && !state.turns[turnId]) {
      const turn: IndexedTurn = {
        block: { id: turnId, threadId: thread.id, start: event.createdAt, end: null,
          status: "running", title: "", initiator: "system", source: "unknown", senderThreadId: null,
          tools: [], counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 }, ask: null },
        prompt: "", startSeq: event.seq, endSeq: null, acceptedRequestIds: [], fallbackRequestId: null,
        toolFrequency: {}, seenItems: [], pending: {}, syntheticEnd: false,
      };
      state.turns[turnId] = turn;
      const fallback = [...state.requests].reverse().find(request => request.assignedTo === null && request.at <= event.createdAt);
      if (fallback) {
        turn.fallbackRequestId = fallback.id;
        fallback.assignedTo = turnId;
        applyRequest(turn, fallback);
        addHandoff(state, thread, turn, fallback);
      }
    }
    const turn = state.turns[turnId];
    if (!turn || !(INDEX_EVENT_TYPES as readonly string[]).includes(event.type)) continue;
    if (turn.syntheticEnd) {
      turn.syntheticEnd = false;
      turn.block.end = null;
      updateWaiting(turn);
    }
    switch (event.type) {
      case "turn/input/accepted": {
        const request = state.requests.find(request => request.id === data.clientRequestId);
        if (!request || turn.acceptedRequestIds.includes(request.id)) break;
        if (turn.acceptedRequestIds.length === 0) {
          // The explicit link supersedes the proximity guess, even across page boundaries.
          if (turn.fallbackRequestId !== request.id) {
            const fallback = state.requests.find(candidate => candidate.id === turn.fallbackRequestId);
            if (fallback?.assignedTo === turnId) fallback.assignedTo = null;
            state.handoffs = state.handoffs.filter(handoff => handoff.toBlockId !== turnId);
          }
          applyRequest(turn, request);
        }
        request.assignedTo = turnId;
        turn.acceptedRequestIds.push(request.id);
        addHandoff(state, thread, turn, request);
        break;
      }
      case "turn/completed":
        turn.block.end = Math.max(turn.block.start, event.createdAt);
        turn.endSeq = event.seq;
        turn.block.status = data.status === "failed" ? "failed"
          : data.status === "completed" ? "done" : "interrupted";
        turn.block.ask = null;
        turn.pending = {};
        break;
      case "system/interaction/lifecycle": {
        if (turn.block.end !== null) break;
        const interaction = object(data.interaction);
        const id = string(interaction.id);
        if (!id) break;
        if (interaction.status === "pending") turn.pending[id] = askFromInteraction(interaction);
        else delete turn.pending[id];
        updateWaiting(turn);
        break;
      }
      case "item/started": {
        const item = object(data.item);
        const id = string(item.id) || `seq:${event.seq}`;
        if (turn.seenItems.includes(id)) break;
        turn.seenItems.push(id);
        const kind = toolKind(item);
        if (item.type === "agentMessage") turn.block.counts.messages++;
        if (!kind) break;
        const count = kind === "command" ? "commands" : kind === "edit" ? "edits"
          : kind === "delegation" ? "delegations" : "tools";
        turn.block.counts[count]++;
        turn.toolFrequency[kind] = (turn.toolFrequency[kind] ?? 0) + 1;
        turn.block.tools = (Object.entries(turn.toolFrequency) as [ToolKind, number][])
          .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([kind]) => kind);
        break;
      }
    }
  }
  return state;
}

/** Call only after all available pages have been folded, never between history pages. */
export function reconcileIdle(state: ThreadIndex, thread: IndexThread): ThreadIndex {
  if (thread.status !== "idle") return state;
  const next = structuredClone(state);
  for (const turn of Object.values(next.turns)) {
    if (turn.block.end !== null) continue;
    turn.syntheticEnd = true;
    turn.block.end = Math.max(turn.block.start, thread.updatedAt);
    turn.block.status = "interrupted";
    turn.block.ask = null;
  }
  return next;
}
