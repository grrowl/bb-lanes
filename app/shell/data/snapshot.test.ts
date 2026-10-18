import { describe, expect, it } from "vitest";
import type { LaneHandoff, LanesSnapshot } from "../../../shared/model";
import { makeBlock, makeThread } from "../testing/fixtures";
import {
  applySignal,
  cacheFromSnapshot,
  isInvalidation,
  overlayLiveState,
  parseSignal,
  settleOverrides,
} from "./snapshot";
import { teamThreadIds } from "./team-scope";

function handoff(from: string, to: string, at = 10): LaneHandoff {
  return { id: `${from}>${to}`, kind: "tell", fromThreadId: from, fromBlockId: null, toThreadId: to, toBlockId: `b_${to}`, at };
}

const snapshot: LanesSnapshot = {
  generatedAt: 1_000,
  since: 0,
  indexing: false,
  blocks: [makeBlock({ id: "b1", threadId: "a", start: 1, end: 5, status: "done" }), makeBlock({ id: "b2", threadId: "z", start: 2 })],
  handoffs: [handoff("a", "z")],
};

describe("snapshot cache", () => {
  it("scopes blocks to the threads asked for and keeps hand-offs touching them", () => {
    const cache = cacheFromSnapshot(snapshot, new Set(["a"]));
    expect([...cache.blocks.keys()]).toEqual(["b1"]);
    expect([...cache.handoffs.keys()]).toEqual(["a>z"]);
  });

  it("upserts signal changes and keeps identity when nothing applies", () => {
    const cache = cacheFromSnapshot(snapshot, null);
    const closed = makeBlock({ id: "b2", threadId: "z", start: 2, end: 9, status: "done" });
    const next = applySignal(cache, { blocks: [closed], handoffs: [], generatedAt: 1_500 }, null);
    expect(next.blocks.get("b2")?.status).toBe("done");
    expect(next.generatedAt).toBe(1_500);
    const scoped = applySignal(cache, { blocks: [closed], handoffs: [], generatedAt: 1_500 }, new Set(["a"]));
    expect(scoped).toBe(cache);
  });

  it("treats malformed payloads as unreadable and empty ones as invalidations", () => {
    expect(parseSignal({ blocks: "nope" })).toBeNull();
    expect(parseSignal(null)).toBeNull();
    const empty = parseSignal({ blocks: [], handoffs: [], generatedAt: 1 });
    expect(empty && isInvalidation(empty)).toBe(true);
  });
});

describe("overlayLiveState", () => {
  it("shows an open block waiting as soon as the sidebar reports a pending interaction", () => {
    const threads = new Map([["a", makeThread({ id: "a", hasPendingInteraction: true, runtimeStatus: "active" })]]);
    const [block] = overlayLiveState([makeBlock({ id: "open", threadId: "a", start: 1 })], threads, new Map());
    expect(block?.status).toBe("waiting");
  });

  it("shows an answered block running until the server catches up", () => {
    const threads = new Map([["a", makeThread({ id: "a", hasPendingInteraction: true, runtimeStatus: "active" })]]);
    const waiting = makeBlock({
      id: "open",
      threadId: "a",
      start: 1,
      status: "waiting",
      ask: { interactionId: "i1", kind: "approval", prompt: "Ship?", canDecideInline: true },
    });
    const overrides = new Map([["open", { blockId: "open", interactionId: "i1", at: 100 }]]);
    expect(overlayLiveState([waiting], threads, overrides)[0]).toMatchObject({ status: "running", ask: null });

    const blocks = new Map([["open", waiting]]);
    expect(settleOverrides(overrides, blocks, 150, 60_000)).toBeNull();
    const asksAgain = { ...waiting, ask: { ...waiting.ask!, interactionId: "i2" } };
    expect(settleOverrides(overrides, new Map([["open", asksAgain]]), 150, 60_000)?.size).toBe(0);
    expect(settleOverrides(overrides, blocks, 100 + 60_001, 60_000)?.size).toBe(0);
  });

  it("starts a provisional block for a busy thread the server has not reported yet", () => {
    const threads = new Map([
      ["busy", makeThread({ id: "busy", runtimeStatus: "active", updatedAt: 50 })],
      ["idle", makeThread({ id: "idle" })],
    ]);
    const result = overlayLiveState([makeBlock({ id: "old", threadId: "busy", start: 1, end: 70, status: "done" })], threads, new Map());
    expect(result.map((block) => [block.id, block.start, block.end])).toEqual([
      ["old", 1, 70],
      ["live:busy", 70, null],
    ]);
  });
});

describe("teamThreadIds", () => {
  const threads = [
    makeThread({ id: "root" }),
    makeThread({ id: "me", parentThreadId: "root" }),
    makeThread({ id: "sibling", parentThreadId: "root" }),
    makeThread({ id: "mine", parentThreadId: "me" }),
    makeThread({ id: "stranger" }),
    makeThread({ id: "peer" }),
  ];

  it("takes the whole tree from the root plus direct hand-off partners", () => {
    const scope = teamThreadIds("me", threads, [handoff("peer", "me"), handoff("stranger", "sibling")]);
    expect([...scope].sort()).toEqual(["me", "mine", "peer", "root", "sibling"]);
  });

  it("includes the thread itself even before the sidebar lists it", () => {
    expect([...teamThreadIds("ghost", threads, [])]).toEqual(["ghost"]);
  });
});
