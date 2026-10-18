import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { LANES_CHANGED, type BlockDetail, type LanesChangedSignal } from "../shared/model";
import { blockDetail } from "./detail";
import { foldEvents, INDEX_EVENT_TYPES, inlineApproval, object, reconcileIdle, type IndexEvent, type IndexThread } from "./indexer";
import { LanesStorage } from "./storage";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const relevantTypes = new Set<string>(INDEX_EVENT_TYPES);
export class LanesService {
  readonly storage: LanesStorage;
  indexing = true;
  private disposed = false;
  private readonly deletedThreads = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly details = new Map<string, { expires: number; value: BlockDetail }>();
  private readonly subscriptions: (() => void)[] = [];
  private readonly controller = new AbortController();
  private backfillJob: Promise<void> | null = null;
  constructor(private readonly bb: BbPluginApi) {
    this.storage = new LanesStorage(bb);
  }
  private publish(blocks: LanesChangedSignal["blocks"] = [], handoffs: LanesChangedSignal["handoffs"] = []) {
    if (this.disposed) return;
    // Empty arrays are an invalidation: removals and bursts over 50 require a full window refetch.
    const overflow = blocks.length + handoffs.length > 50;
    this.bb.realtime.publish(LANES_CHANGED, {
      blocks: overflow ? [] : blocks, handoffs: overflow ? [] : handoffs, generatedAt: Date.now(),
    } satisfies LanesChangedSignal);
  }
  schedule(threadId: string) {
    if (this.disposed) return;
    const previous = this.timers.get(threadId);
    if (previous) clearTimeout(previous);
    this.timers.set(threadId, setTimeout(() => {
      this.timers.delete(threadId);
      void this.refresh(threadId).catch(() => {
        if (this.disposed) return;
        this.bb.log.warn(`Could not update lane ${threadId}; retrying`);
        this.timers.set(threadId, setTimeout(() => {
          this.timers.delete(threadId);
          this.schedule(threadId);
        }, 5000));
      });
    }, 150));
  }
  refresh(threadId: string): Promise<void> {
    const previous = this.jobs.get(threadId) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(() => this.indexThread(threadId));
    this.jobs.set(threadId, job);
    void job.finally(() => {
      if (this.jobs.get(threadId) === job) this.jobs.delete(threadId);
    }).catch(() => {});
    return job;
  }
  private async indexThread(threadId: string) {
    if (this.disposed || this.deletedThreads.has(threadId)) return;
    const signal = this.controller.signal;
    const thread = await this.bb.sdk.threads.get({ threadId, signal });
    if (this.disposed) return;
    const previous = this.storage.read(threadId);
    const oldHandoffs = this.storage.handoffsFor(threadId);
    let next = previous;
    for (;;) {
      const events = await this.bb.sdk.threads.events.list({ threadId,
        afterSeq: String(next.lastSeq), limit: String(PAGE_SIZE), order: "asc", types: INDEX_EVENT_TYPES, signal });
      if (this.disposed) return;
      next = foldEvents(next, events, thread);
      if (events.length < PAGE_SIZE) break;
    }
    // Status may have changed while paging history; only the final live state can close a crashed turn.
    const hasOpen = Object.values(next.turns).some(turn => turn.block.end === null);
    const current = hasOpen && thread.status === "idle"
      ? await this.bb.sdk.threads.get({ threadId, signal }) : thread;
    if (this.disposed) return;
    if (this.deletedThreads.has(threadId)) return;
    next = reconcileIdle(next, current);
    const changed = Object.values(next.turns).filter(turn =>
      JSON.stringify(previous.turns[turn.block.id]?.block) !== JSON.stringify(turn.block)).map(turn => turn.block);
    const removed = Object.keys(previous.turns).some(id => !next.turns[id]);
    this.storage.save(current, next);
    for (const key of this.details.keys()) if (key.startsWith(`${threadId}:`)) this.details.delete(key);
    const handoffs = this.storage.handoffsFor(threadId);
    const old = new Map(oldHandoffs.map(handoff => [handoff.id, JSON.stringify(handoff)]));
    const changedHandoffs = handoffs.filter(handoff => old.get(handoff.id) !== JSON.stringify(handoff));
    if (removed || oldHandoffs.some(handoff => !handoffs.some(next => next.id === handoff.id))) this.publish();
    else if (changed.length || changedHandoffs.length) this.publish(changed, changedHandoffs);
  }
  private backfill(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.backfillJob) return this.backfillJob;
    const wasIndexing = this.indexing;
    this.indexing = true;
    if (!wasIndexing) this.publish();
    const job = this.runBackfill().finally(() => {
      if (this.backfillJob === job) this.backfillJob = null;
    });
    this.backfillJob = job;
    return job;
  }
  private async runBackfill() {
    const threads: IndexThread[] = [];
    const signal = this.controller.signal;
    const openIds = new Set(this.storage.open().map(row => row.thread.id));
    for (let offset = 0; !this.disposed; offset += PAGE_SIZE) {
      const page = await this.bb.sdk.threads.list({ limit: PAGE_SIZE, offset, signal });
      threads.push(...page.filter(thread => thread.updatedAt >= Date.now() - WEEK
        || thread.status === "active" || thread.status === "starting" || openIds.has(thread.id)));
      if (page.length < PAGE_SIZE) break;
    }
    threads.sort((a, b) => b.updatedAt - a.updatedAt);
    // Two readers bound disk/network pressure while newest threads become available first.
    let cursor = 0;
    const worker = async () => {
      while (!this.disposed && cursor < threads.length) {
        const thread = threads[cursor++];
        await this.refresh(thread.id);
      }
    };
    const results = await Promise.allSettled([worker(), worker()]);
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (this.disposed) return;
    this.indexing = false;
    this.publish();
  }
  async start(signal: AbortSignal) {
    if (signal.aborted || this.disposed) return;
    const stop = () => this.dispose();
    signal.addEventListener("abort", stop, { once: true });
    this.subscriptions.push(this.bb.sdk.subscribe({ event: "thread:changed", callback: event => {
      if (this.disposed) return;
      if (!event.id) {
        void this.backfill().catch(() => {
          if (!this.disposed) this.bb.log.warn("Could not reconcile lanes after invalidation");
        });
        return;
      }
      if (event.changes.includes("thread-created")) this.deletedThreads.delete(event.id);
      if (event.changes.includes("thread-deleted")) {
        this.deletedThreads.add(event.id);
        const timer = this.timers.get(event.id);
        if (timer) clearTimeout(timer);
        this.timers.delete(event.id);
        this.storage.remove(event.id);
        this.publish();
        return;
      }
      const contentChange = event.changes.some(change => ["thread-created", "status-changed", "parent-changed",
        "interactions-changed", "history-compacted", "history-rewritten", "title-changed"].includes(change));
      const types = event.metadata?.eventTypes;
      if (!contentChange && !event.changes.includes("events-appended")) return;
      if (!contentChange && types?.length && !types.some(type => relevantTypes.has(type))) return;
      this.schedule(event.id);
    } }));
    this.subscriptions.push(this.bb.sdk.subscribe({ event: "realtime:connection", callback: event => {
      if (event.state === "connected" && event.reconnected) {
        void this.backfill().catch(() => {
          if (!this.disposed) this.bb.log.warn("Could not reconcile lanes after reconnect");
        });
      }
    } }));
    try {
      await this.backfill();
      if (!this.disposed) await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } catch (error) {
      if (!signal.aborted && !this.disposed) throw error;
    } finally {
      signal.removeEventListener("abort", stop);
      for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
      if (signal.aborted) this.dispose();
      await Promise.allSettled([...this.jobs.values()]);
    }
  }
  async detail(threadId: string, blockId: string): Promise<BlockDetail> {
    const key = `${threadId}:${blockId}`;
    const cached = this.details.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const turn = this.storage.read(threadId).turns[blockId];
    if (!turn) throw new Error("This turn is no longer available");
    const events: IndexEvent[] = [];
    let afterSeq = turn.startSeq - 1;
    for (;;) {
      const page = await this.bb.sdk.threads.events.list({ threadId,
        afterSeq: String(afterSeq), ...(turn.endSeq === null ? {} : { beforeSeq: String(turn.endSeq + 1) }),
        types: ["item/started", "item/completed"], limit: String(PAGE_SIZE), order: "asc", signal: this.controller.signal });
      events.push(...page);
      if (page.length < PAGE_SIZE) break;
      afterSeq = page[page.length - 1].seq;
    }
    const value = blockDetail(threadId, turn, events);
    if (this.details.size >= 200) this.details.delete(this.details.keys().next().value!);
    this.details.set(key, { expires: Date.now() + 15_000, value });
    return value;
  }
  async decide(threadId: string, interactionId: string, decision: "approve" | "reject") {
    try {
      const interaction = await this.bb.sdk.threads.interactions.get({ threadId, interactionId, signal: this.controller.signal });
      if (interaction.status !== "pending") return { ok: false, message: "This request has already been answered" };
      if (!inlineApproval(object(interaction.payload))) return { ok: false, message: "Answer this request in the thread" };
      await this.bb.sdk.threads.interactions.resolve({ threadId, interactionId,
        resolution: decision === "approve" ? { decision: "allow_once", grantedPermissions: null } : { decision: "deny" } });
      this.schedule(threadId);
      return { ok: true, message: null };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Could not answer this request" };
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.details.clear();
  }
}
