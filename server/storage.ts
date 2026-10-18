import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { LaneBlock, LaneHandoff, LanesSnapshot } from "../shared/model";
import { emptyIndex, INDEX_VERSION, type IndexThread, type ThreadIndex } from "./indexer";

type JsonRow = { json: string };
export class LanesStorage {
  private readonly db;
  constructor(bb: BbPluginApi) {
    this.db = bb.storage.database();
    bb.storage.migrate(this.db, [
      `CREATE TABLE lane_threads (id TEXT PRIMARY KEY, state TEXT NOT NULL, metadata TEXT NOT NULL)`,
      `CREATE TABLE lane_blocks (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, start REAL NOT NULL, end REAL, json TEXT NOT NULL)`,
      `CREATE INDEX lane_blocks_window ON lane_blocks(end, start)`,
      `CREATE INDEX lane_blocks_thread ON lane_blocks(thread_id, start)`,
      `CREATE TABLE lane_handoffs (id TEXT PRIMARY KEY, from_thread_id TEXT NOT NULL, to_thread_id TEXT NOT NULL, target_id TEXT NOT NULL, at REAL NOT NULL, json TEXT NOT NULL)`,
      `CREATE INDEX lane_handoffs_window ON lane_handoffs(at)`,
      `CREATE INDEX lane_handoffs_target ON lane_handoffs(to_thread_id)`,
      `CREATE INDEX lane_handoffs_source ON lane_handoffs(from_thread_id)`,
    ]);
  }
  read(threadId: string): ThreadIndex {
    const row = this.db.prepare("SELECT state FROM lane_threads WHERE id = ?").get(threadId) as { state: string } | undefined;
    if (!row) return emptyIndex();
    const state = JSON.parse(row.state) as ThreadIndex;
    return state.version === INDEX_VERSION ? state : emptyIndex();
  }
  save(thread: IndexThread, state: ThreadIndex) {
    this.db.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO lane_threads VALUES (?, ?, ?)")
        .run(thread.id, JSON.stringify(state), JSON.stringify(thread));
      const previous = this.db.prepare("SELECT id, json FROM lane_blocks WHERE thread_id = ?")
        .all(thread.id) as { id: string; json: string }[];
      const old = new Map(previous.map(row => [row.id, row.json]));
      const put = this.db.prepare("INSERT OR REPLACE INTO lane_blocks VALUES (?, ?, ?, ?, ?)");
      for (const { block } of Object.values(state.turns)) {
        const json = JSON.stringify(block);
        if (old.get(block.id) !== json) put.run(block.id, block.threadId, block.start, block.end, json);
        old.delete(block.id);
      }
      for (const id of old.keys()) this.db.prepare("DELETE FROM lane_blocks WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM lane_handoffs WHERE to_thread_id = ?").run(thread.id);
      const putHandoff = this.db.prepare("INSERT INTO lane_handoffs VALUES (?, ?, ?, ?, ?, ?)");
      for (const handoff of state.handoffs) putHandoff.run(handoff.id, handoff.fromThreadId,
        handoff.toThreadId, handoff.toBlockId, handoff.at, JSON.stringify(handoff));
    })();
  }
  remove(threadId: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM lane_threads WHERE id = ?").run(threadId);
      this.db.prepare("DELETE FROM lane_blocks WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM lane_handoffs WHERE to_thread_id = ? OR from_thread_id = ?").run(threadId, threadId);
    })();
  }
  private resolveHandoffs(rows: JsonRow[]): LaneHandoff[] {
    const source = this.db.prepare(`SELECT id FROM lane_blocks WHERE thread_id = ? AND start <= ?
      AND (end IS NULL OR end >= ?) ORDER BY start DESC LIMIT 1`);
    return rows.map(row => {
      const handoff = JSON.parse(row.json) as LaneHandoff;
      handoff.fromBlockId = (source.get(handoff.fromThreadId, handoff.at, handoff.at) as { id: string } | undefined)?.id ?? null;
      return handoff;
    });
  }
  handoffsFor(threadId: string): LaneHandoff[] {
    return this.resolveHandoffs(this.db.prepare("SELECT json FROM lane_handoffs WHERE to_thread_id = ? OR from_thread_id = ?")
      .all(threadId, threadId) as JsonRow[]);
  }
  window(since: number, indexing: boolean, threadIds?: string[]): LanesSnapshot {
    const generatedAt = Date.now();
    if (threadIds?.length === 0) return { generatedAt, since, blocks: [], handoffs: [], indexing };
    const placeholders = threadIds?.map(() => "?").join(",");
    const scope = placeholders ? ` AND thread_id IN (${placeholders})` : "";
    const blocks = (this.db.prepare(`SELECT json FROM lane_blocks
      WHERE (end IS NULL OR (end >= ? AND start <= ?))${scope} ORDER BY start, id`)
      .all(since, generatedAt, ...(threadIds ?? [])) as JsonRow[])
      .map(row => JSON.parse(row.json) as LaneBlock);
    const handoffScope = placeholders ? ` AND (h.to_thread_id IN (${placeholders}) OR h.from_thread_id IN (${placeholders}))` : "";
    const handoffs = this.resolveHandoffs(this.db.prepare(`SELECT h.json FROM lane_handoffs h
      JOIN lane_blocks b ON b.id = h.target_id
      WHERE ((h.at >= ? AND h.at <= ?) OR b.end IS NULL OR (b.end >= ? AND b.start <= ?))${handoffScope}
      ORDER BY h.at, h.id`).all(since, generatedAt, since, generatedAt, ...(threadIds ?? []), ...(threadIds ?? [])) as JsonRow[]);
    return { generatedAt, since, blocks, handoffs, indexing };
  }
  open(): { block: LaneBlock; thread: IndexThread }[] {
    return (this.db.prepare(`SELECT b.json, t.metadata FROM lane_blocks b
      JOIN lane_threads t ON t.id = b.thread_id WHERE b.end IS NULL ORDER BY b.start`).all() as { json: string; metadata: string }[])
      .map(row => ({ block: JSON.parse(row.json) as LaneBlock, thread: JSON.parse(row.metadata) as IndexThread }));
  }
}
