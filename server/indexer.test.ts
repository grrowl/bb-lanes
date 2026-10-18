import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyIndex, foldEvents, reconcileIdle, type IndexEvent, type IndexThread } from "./indexer";

const thread: IndexThread = { id: "child", parentThreadId: "parent", status: "active", updatedAt: 1000 };
const event = (seq: number, type: string, turnId?: string, data: unknown = {}): IndexEvent => ({
  seq, createdAt: seq * 10, type, scope: turnId ? { kind: "turn", turnId } : { kind: "thread" }, data,
});
const request = (seq: number, id: string, source = "send", senderThreadId: string | null = null) =>
  event(seq, "client/turn/requested", undefined, { requestId: id, source, initiator: senderThreadId ? "agent" : "user", senderThreadId,
    input: [{ type: "text", text: `${id} first line\nMore detail` }], execution: { model: `model-${id}` } });
const started = (seq: number, id = "turn") => event(seq, "turn/started", id);
const accepted = (seq: number, requestId: string, id = "turn") => event(seq, "turn/input/accepted", id, { clientRequestId: requestId });
const interaction = (seq: number, id: string, status: string, payload: unknown, turnId = "turn") =>
  event(seq, "system/interaction/lifecycle", turnId, { interaction: { id, status, payload } });
const approval = { kind: "approval", availableDecisions: ["allow_once", "deny"], subject: { command: "npm test" } };
const fold = (events: IndexEvent[]) => foldEvents(emptyIndex(), events, thread);

describe("thread event fold", () => {
  it("opens and completes a turn with prompt, model and attribution", () => {
    const state = fold([request(1, "r", "spawn"), started(2), accepted(3, "r"), event(4, "turn/completed", "turn", { status: "completed" })]);
    expect(state.turns.turn.block).toMatchObject({ title: "r first line", model: "model-r", status: "done", start: 20, end: 40,
      initiator: "user", source: "spawn", ask: null });
    expect(state.handoffs).toEqual([{ id: "parent>turn", kind: "spawn", fromThreadId: "parent", fromBlockId: null,
      toThreadId: "child", toBlockId: "turn", at: 10 }]);
  });
  it("allows provider turns without an input request", () => {
    expect(fold([started(1)]).turns.turn.block).toMatchObject({ title: "", status: "running", end: null });
  });
  it("prefers explicit accepted links and keeps the first accepted input and model for grouped requests", () => {
    const events = [request(1, "first", "tell", "sender-one"), request(2, "second", "tell", "sender-two"), started(3),
      accepted(4, "first"), accepted(5, "second")];
    const state = fold(events);
    expect(state.turns.turn.block).toMatchObject({ title: "first first line", senderThreadId: "sender-one", model: "model-first" });
    expect(state.handoffs.map(h => h.fromThreadId)).toEqual(["sender-one", "sender-two"]);
    const partial = foldEvents(emptyIndex(), events.slice(0, 3), thread);
    expect(foldEvents(partial, events.slice(3), thread)).toEqual(state);
  });
  it("does not let a proximity fallback steal the next turn's linked input", () => {
    const state = fold([request(1, "one"), request(2, "two"), started(3, "a"), accepted(4, "one", "a"),
      started(5, "b"), accepted(6, "two", "b")]);
    expect(state.turns.a.block.title).toBe("one first line");
    expect(state.turns.b.block.title).toBe("two first line");
  });
  it("uses data.model as a fallback and never replaces the first model on steering", () => {
    const first = request(1, "a");
    first.data = { requestId: "a", model: "legacy", input: [{ text: "Hello" }] };
    const state = fold([first, started(2), accepted(3, "a"), request(4, "b"), accepted(5, "b")]);
    expect(state.turns.turn.block.model).toBe("legacy");
  });
  it.each(["failed", "interrupted", "cancelled"])("maps terminal status %s", status => {
    expect(fold([started(1), event(2, "turn/completed", "turn", { status })]).turns.turn.block.status)
      .toBe(status === "failed" ? "failed" : "interrupted");
  });
  it("keeps multiple blockers waiting until every pending interaction clears", () => {
    let state = fold([started(1), interaction(2, "approval", "pending", approval),
      interaction(3, "question", "pending", { kind: "user_question", questions: [{ prompt: "Which project?" }] }),
      interaction(4, "question", "resolved", {})]);
    expect(state.turns.turn.block).toMatchObject({ status: "waiting", ask: { interactionId: "approval", canDecideInline: true, prompt: "npm test" } });
    state = foldEvents(state, [interaction(5, "approval", "resolving", approval)], thread);
    expect(state.turns.turn.block).toMatchObject({ status: "running", ask: null });
  });
  it("only exposes allow-once/deny approvals inline, and clears cancelled questions", () => {
    let state = fold([started(1), interaction(2, "q", "pending", { kind: "user_question", questions: [{ prompt: "Choose?" }] })]);
    expect(state.turns.turn.block.ask).toMatchObject({ canDecideInline: false, prompt: "Choose?" });
    state = foldEvents(state, [interaction(3, "q", "cancelled", {}), interaction(4, "a", "pending", {
      ...approval, availableDecisions: ["allow_for_session", "deny"],
    })], thread);
    expect(state.turns.turn.block.ask?.canDecideInline).toBe(false);
  });
  it("counts item families once and ranks the three most used tool kinds", () => {
    const items = ["commandExecution", "fileChange", "toolCall", "toolCall", "toolCall", "delegation", "agentMessage", "webSearch", "mcpToolCall"];
    const events = items.map((type, i) => event(i + 2, "item/started", "turn", { item: { type, id: `i${i}`, tool: i === 2 ? "Skill" : i === 3 ? "mcp__test" : "web_search" } }));
    const duplicate = event(20, "item/started", "turn", { item: { type: "commandExecution", id: "i0" } });
    const state = fold([started(1), ...events, duplicate]);
    expect(state.turns.turn.block.counts).toEqual({ commands: 1, edits: 1, tools: 5, delegations: 1, messages: 1 });
    expect(state.turns.turn.block.tools).toEqual(["mcp", "web", "command"]);
  });
  it("drops an edited-away turn, its handoffs, and ignores later references", () => {
    const state = fold([request(1, "r", "tell", "sender"), started(2), event(3, "system/operation", undefined,
      { operation: "edit_message", metadata: { removedTurnId: "turn" } }), started(4), event(5, "turn/completed", "turn", { status: "completed" })]);
    expect(Object.keys(state.turns)).toEqual([]);
    expect(state.handoffs).toEqual([]);
  });
  it("closes crash-orphaned turns only after history is read, using updatedAt", () => {
    const state = fold([started(1)]);
    const closed = reconcileIdle(state, { ...thread, status: "idle", updatedAt: 123 });
    expect(closed.turns.turn.block).toMatchObject({ status: "interrupted", end: 123 });
    expect(state.turns.turn.block.end).toBeNull();
    expect(foldEvents(closed, [event(20, "turn/completed", "turn", { status: "completed" })], thread).turns.turn.block)
      .toMatchObject({ status: "done", end: 200 });
  });
  it("ignores unknown events and duplicate seqs", () => {
    const state = fold([started(1), event(2, "future/event", "turn")]);
    expect(foldEvents(state, [event(2, "item/started", "turn", { item: { type: "commandExecution" } })], thread)).toEqual(state);
    expect(state.lastSeq).toBe(2);
  });
  it("does not reopen a crash-closed turn for unknown events", () => {
    const closed = reconcileIdle(fold([started(1)]), { ...thread, status: "idle" });
    expect(foldEvents(closed, [event(2, "future/event", "turn")], thread).turns.turn.block)
      .toMatchObject({ status: "interrupted", end: thread.updatedAt });
  });
  it("folds the real redacted fixture equally in one pass and event by event", () => {
    const events = JSON.parse(readFileSync(new URL("../reference/sample-thread-events.json", import.meta.url), "utf8")) as IndexEvent[];
    const whole = fold(events);
    const incremental = events.reduce((state, event) => foldEvents(state, [event], thread), emptyIndex());
    expect(incremental).toEqual(whole);
    expect(Object.keys(whole.turns)).toHaveLength(6);
    expect(whole.turns["dadaa17abc-t1"].block.counts.commands).toBe(3);
  });
});
