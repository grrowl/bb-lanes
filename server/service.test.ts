import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { LANES_CHANGED, type LanesSnapshot } from "../shared/model";
import { emptyIndex, foldEvents, type IndexEvent, type IndexThread } from "./indexer";
import { LanesStorage } from "./storage";

type Subscription = Parameters<BbPluginApi["sdk"]["subscribe"]>[0];
type ThreadSubscription = Extract<Subscription, { event: "thread:changed" }>;
type EventListArgs = Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0];
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.useRealTimers();
});
function event(seq: number, type: string, turnId: string, data: unknown = {}, at = seq * 10): IndexEvent {
  return { seq, type, createdAt: at, scope: { kind: "turn", turnId }, data };
}
function seed(storage: LanesStorage, id: string, start: number, end: number | null, parentThreadId: string | null = null) {
  const thread = { id, parentThreadId, status: "active", updatedAt: Date.now(), title: `Thread ${id}`, projectId: "p" };
  const events = [event(1, "client/turn/requested", "", { requestId: "r", source: parentThreadId ? "spawn" : "send",
    input: [{ type: "text", text: "Do the work" }] }, start), event(2, "turn/started", `turn-${id}`, {}, start)];
  if (end !== null) events.push(event(3, "turn/completed", `turn-${id}`, { status: "completed" }, end));
  storage.save(thread, foldEvents(emptyIndex(), events, thread));
}
function setup(initial: IndexEvent[] = []) {
  const thread = makeThreadResponse({ id: "t", status: "active", title: "Build lanes", updatedAt: Date.now() });
  let events = initial;
  let subscription: ThreadSubscription | undefined;
  const unsubscribe = vi.fn();
  const list = vi.fn(async (args: EventListArgs) => events.filter(event => event.seq > Number(args.afterSeq ?? 0)
    && (args.beforeSeq === undefined || event.seq < Number(args.beforeSeq))
    && (!args.types || args.types.some(type => type === event.type))).slice(0, Number(args.limit ?? 500)));
  const host = createFakePluginHost({ pluginId: "lanes", sdk: {
    threads: { list: async () => [thread], get: async () => thread, events: { list } },
    projects: { list: async () => [{ id: thread.projectId, name: "Lanes project" }] },
    subscribe: args => {
      if (args.event === "thread:changed") subscription = args;
      return unsubscribe;
    },
  } });
  hosts.push(host);
  return { ...host, list, unsubscribe, setEvents: (next: IndexEvent[]) => { events = next; },
    emit: (changes: ThreadSubscription extends { callback: (event: infer E) => void } ? E : never) => subscription!.callback(changes) };
}
async function boot(host: ReturnType<typeof setup>) {
  await plugin(host.bb);
  const service = host.harness.behavior.runService("lanes-indexer");
  await vi.waitFor(async () => {
    const window = await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot;
    expect(window.indexing).toBe(false);
  });
  return service;
}

describe("lanes backend", () => {
  it("serves inclusive window overlaps and open blocks from SQLite without event reads", async () => {
    const host = setup();
    await plugin(host.bb);
    const storage = new LanesStorage(host.bb);
    seed(storage, "old", 10, 50);
    seed(storage, "edge", 50, 100);
    seed(storage, "current", 150, 200);
    seed(storage, "open", 1, null);
    const snapshot = await host.harness.behavior.callRpc("lanes_window", { since: 100 }) as LanesSnapshot;
    expect(snapshot.blocks.map(b => b.id)).toEqual(["turn-open", "turn-edge", "turn-current"]);
    expect(snapshot.generatedAt).toBeGreaterThanOrEqual(Date.now() - 50);
    expect(host.list).not.toHaveBeenCalled();
    const scoped = await host.harness.behavior.callRpc("lanes_window", { since: 100, threadIds: ["current"] }) as LanesSnapshot;
    expect(scoped.blocks.map(b => b.id)).toEqual(["turn-current"]);
    expect((await host.harness.behavior.callRpc("lanes_window", { since: 0, threadIds: [] }) as LanesSnapshot).blocks).toEqual([]);
  });
  it("includes handoffs whose target overlaps and resolves the sender turn independent of index order", async () => {
    const host = setup();
    await plugin(host.bb);
    const storage = new LanesStorage(host.bb);
    seed(storage, "child", 30, 200, "parent");
    seed(storage, "parent", 1, 100);
    const snapshot = storage.window(150, false);
    expect(snapshot.handoffs).toMatchObject([{ at: 30, fromBlockId: "turn-parent", toBlockId: "turn-child" }]);
    expect(storage.window(150, false, ["child"]).handoffs).toHaveLength(1);
    expect(storage.window(150, false, ["parent"]).handoffs).toHaveLength(1);
  });
  it("publishes live changes after a per-thread debounce and only fetches new filtered events", async () => {
    vi.useFakeTimers();
    const host = setup([event(1, "turn/started", "turn")]);
    const service = await boot(host);
    host.setEvents([event(1, "turn/started", "turn"), event(3, "turn/completed", "turn", { status: "completed" })]);
    const message = { type: "changed", entity: "thread", id: "t", changes: ["events-appended"], metadata: { eventTypes: ["turn/completed"] } } as const;
    host.emit(message);
    host.emit(message);
    await vi.advanceTimersByTimeAsync(160);
    const calls = host.list.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toMatchObject({ afterSeq: "1", types: expect.arrayContaining(["turn/started", "turn/input/accepted"]) });
    const signal = host.harness.inspection.realtimeSignals.filter(signal => signal.channel === LANES_CHANGED).at(-1);
    expect(signal?.payload).toMatchObject({ blocks: [{ id: "turn", status: "done", end: 30 }] });
    service.controller.abort();
    await service.done;
    expect(host.unsubscribe).toHaveBeenCalledTimes(2);
    const before = host.list.mock.calls.length;
    host.emit(message);
    await vi.advanceTimersByTimeAsync(200);
    expect(host.list).toHaveBeenCalledTimes(before);
  });
  it("skips delta-only appends and catches history changes", async () => {
    vi.useFakeTimers();
    const host = setup([event(1, "turn/started", "turn")]);
    await boot(host);
    host.emit({ type: "changed", entity: "thread", id: "t", changes: ["events-appended"], metadata: { eventTypes: ["item/agentMessage/delta"] } });
    await vi.advanceTimersByTimeAsync(200);
    expect(host.list).toHaveBeenCalledTimes(1);
    host.setEvents([event(2, "system/operation", "", { operation: "edit_message", metadata: { removedTurnId: "turn" } })]);
    host.emit({ type: "changed", entity: "thread", id: "t", changes: ["history-rewritten"] });
    await vi.advanceTimersByTimeAsync(200);
    expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).blocks).toEqual([]);
    expect(host.harness.inspection.realtimeSignals.at(-1)?.payload).toMatchObject({ blocks: [], handoffs: [] });
  });
  it("invalidates bursts above fifty instead of sending a truncated patch", async () => {
    const events = Array.from({ length: 51 }, (_, i) => event(i + 1, "turn/started", `turn-${i}`));
    const host = setup(events);
    await boot(host);
    const signals = host.harness.inspection.realtimeSignals;
    expect(signals).toHaveLength(2);
    expect(signals[0].payload).toMatchObject({ blocks: [], handoffs: [] });
    expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).blocks).toHaveLength(51);
  });
  it("persists cursors and open state across plugin reload", async () => {
    const host = setup([event(1, "turn/started", "turn")]);
    await boot(host);
    const next = await host.harness.lifecycle.reload(plugin);
    const service = next.harness.behavior.runService("lanes-indexer");
    await vi.waitFor(() => expect(host.list).toHaveBeenCalledTimes(2));
    expect(host.list.mock.calls[1][0].afterSeq).toBe("1");
    expect((await next.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).blocks[0].end).toBeNull();
    service.controller.abort();
    await service.done;
    await next.harness.lifecycle.dispose();
  });
  it("loads final messages and recent item labels lazily and caches detail", async () => {
    const host = setup([
      event(1, "client/turn/requested", "", { requestId: "r", input: [{ text: "Build the pane\nKeep it clear" }] }),
      event(2, "turn/started", "turn"),
      event(3, "item/started", "turn", { item: { type: "commandExecution", id: "i", command: "npm test", presentation: { title: "Run tests" } } }),
      event(4, "item/completed", "turn", { item: { type: "agentMessage", id: "a", text: "Built the pane. All tests passed! Ready to review." } }),
      event(5, "turn/completed", "turn", { status: "completed" }),
    ]);
    await boot(host);
    expect(host.list).toHaveBeenCalledTimes(1);
    const input = { threadId: "t", blockId: "turn" };
    const detail = await host.harness.behavior.callRpc("lanes_block_detail", input);
    expect(detail).toMatchObject({ summary: ["Built the pane.", "All tests passed!", "Ready to review."],
      prompt: "Build the pane\nKeep it clear", recent: [{ kind: "command", label: "Run tests" }] });
    await host.harness.behavior.callRpc("lanes_block_detail", input);
    expect(host.list).toHaveBeenCalledTimes(2);
    expect(host.list.mock.calls[1][0]).toMatchObject({ types: ["item/started", "item/completed"], afterSeq: "1", beforeSeq: "6" });
  });
  it("resolves supported approvals once, with the typed allow/deny payload", async () => {
    const host = setup();
    await plugin(host.bb);
    host.harness.inspection.sdk.stub("threads.interactions.get", async () => ({ status: "pending", payload: {
      kind: "approval", availableDecisions: ["allow_once", "deny"],
    } }));
    const resolve = vi.fn(async () => ({}));
    host.harness.inspection.sdk.stub("threads.interactions.resolve", resolve);
    const input = { threadId: "t", interactionId: "a", decision: "approve" };
    expect(await host.harness.behavior.callRpc("lanes_decide", input)).toEqual({ ok: true, message: null });
    expect(resolve).toHaveBeenLastCalledWith({ threadId: "t", interactionId: "a", resolution: { decision: "allow_once", grantedPermissions: null } });
    await host.harness.behavior.callRpc("lanes_decide", { ...input, decision: "reject" });
    expect(resolve).toHaveBeenLastCalledWith({ threadId: "t", interactionId: "a", resolution: { decision: "deny" } });
  });
  it.each([
    [{ status: "resolved", payload: { kind: "approval" } }, "already been answered"],
    [{ status: "pending", payload: { kind: "user_question" } }, "in the thread"],
    [{ status: "pending", payload: { kind: "approval", availableDecisions: ["allow_for_session", "deny"] } }, "in the thread"],
  ])("returns expected approval failures without throwing", async (interaction, message) => {
    const host = setup();
    await plugin(host.bb);
    host.harness.inspection.sdk.stub("threads.interactions.get", async () => interaction);
    const result = await host.harness.behavior.callRpc("lanes_decide", { threadId: "t", interactionId: "a", decision: "approve" });
    expect(result).toEqual({ ok: false, message: expect.stringContaining(message) });
    expect(host.harness.inspection.sdk.callsTo("threads.interactions.resolve")).toEqual([]);
  });
  it("handles a resolution race as an ordinary decision failure", async () => {
    const host = setup();
    await plugin(host.bb);
    host.harness.inspection.sdk.stub("threads.interactions.get", async () => { throw new Error("Interaction no longer exists"); });
    expect(await host.harness.behavior.callRpc("lanes_decide", { threadId: "t", interactionId: "gone", decision: "reject" }))
      .toEqual({ ok: false, message: "Interaction no longer exists" });
  });
  it("pages filtered histories past the SDK page boundary", async () => {
    const host = setup(Array.from({ length: 502 }, (_, i) => event(i + 1, "turn/started", `turn-${i}`)));
    await boot(host);
    expect(host.list).toHaveBeenCalledTimes(2);
    expect(host.list.mock.calls[1][0].afterSeq).toBe("500");
    expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).blocks).toHaveLength(502);
  });
  it("allows the host to restart a failed indexer service", async () => {
    const host = setup([event(1, "turn/started", "turn")]);
    host.list.mockRejectedValueOnce(new Error("Transient history read failure"));
    await plugin(host.bb);
    const first = host.harness.behavior.runService("lanes-indexer");
    await expect(first.done).rejects.toThrow("Transient history read failure");
    const second = host.harness.behavior.runService("lanes-indexer");
    await vi.waitFor(async () => expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).indexing).toBe(false));
    second.controller.abort();
    await second.done;
  });
  it("stops an in-flight history read promptly when the service aborts", async () => {
    const host = setup();
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    host.list.mockImplementationOnce(args => new Promise((_resolve, reject) => {
      entered();
      args.signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    await plugin(host.bb);
    const service = host.harness.behavior.runService("lanes-indexer");
    await reading;
    service.controller.abort();
    await expect(service.done).resolves.toBeUndefined();
    expect(host.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("never restores a deleted thread when its pending history read completes", async () => {
    const host = setup();
    let entered!: () => void;
    let release!: (events: IndexEvent[]) => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    host.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; entered(); }));
    await plugin(host.bb);
    const service = host.harness.behavior.runService("lanes-indexer");
    await reading;
    host.emit({ type: "changed", entity: "thread", id: "t", changes: ["thread-deleted"] });
    release([event(1, "turn/started", "turn")]);
    await vi.waitFor(async () => expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).indexing).toBe(false));
    expect((await host.harness.behavior.callRpc("lanes_window", { since: 0 }) as LanesSnapshot).blocks).toEqual([]);
    service.controller.abort();
    await service.done;
  });
  it("prints help and bounds CLI rows while retaining the total needing a person", async () => {
    const host = setup();
    await plugin(host.bb);
    const storage = new LanesStorage(host.bb);
    for (let i = 0; i < 55; i++) seed(storage, `t${i}`, i, null);
    expect((await host.harness.behavior.runCli([])).stdout).toContain("bb lanes now");
    const result = await host.harness.behavior.runCli(["now", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ total: 55, needsYou: 0, threads: expect.any(Array) });
    expect(JSON.parse(result.stdout).threads).toHaveLength(50);
    expect((await host.harness.behavior.runCli(["now"])).stdout).toContain("Showing 50 of 55");
  });
  it("queries a seven-day window across 200 threads without scanning events", async () => {
    const host = setup();
    await plugin(host.bb);
    const storage = new LanesStorage(host.bb);
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      const thread: IndexThread = { id: `perf-${i}`, status: "idle", parentThreadId: null, updatedAt: now };
      const events: IndexEvent[] = [];
      for (let j = 0; j < 20; j++) {
        events.push(event(j * 2 + 1, "turn/started", `${i}-${j}`, {}, now - (j + 1) * 60000));
        events.push(event(j * 2 + 2, "turn/completed", `${i}-${j}`, { status: "completed" }, now - j * 60000));
      }
      storage.save(thread, foldEvents(emptyIndex(), events, thread));
    }
    const start = performance.now();
    const snapshot = storage.window(now - 7 * 86400000, false);
    expect(snapshot.blocks).toHaveLength(4000);
    expect(performance.now() - start).toBeLessThan(50);
    expect(host.list).not.toHaveBeenCalled();
  });
});
