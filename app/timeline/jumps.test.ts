import { describe, expect, it } from "vitest";
import type { LaneBlock } from "../../shared/model";
import { formatDistance, jumpDistance, laneJumps, zipLanding } from "./jumps";
import { indexBlocks } from "./layout";
import { DAY, HOUR, MINUTE } from "./time";

const NOW = Date.UTC(2026, 9, 18, 12);
const m = (minutes: number) => NOW + minutes * MINUTE;

function b(id: string, start: number, end: number | null): LaneBlock {
  return {
    id,
    threadId: "t",
    start,
    end,
    status: end === null ? "running" : "done",
    title: id,
    initiator: "user",
    source: "send",
    senderThreadId: null,
    tools: [],
    counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
    ask: null,
  };
}

const series = (...blocks: LaneBlock[]) => indexBlocks(blocks).byThread.get("t");
// A 15 minute window ending now, and the same window panned back an hour.
const live = { from: m(-15), to: NOW, live: true };
const past = { from: m(-75), to: m(-60), live: false };

describe("lane jumpers", () => {
  it("offers the previous turn when the window's left half is empty", () => {
    const jumps = laneJumps(series(b("old", m(-40), m(-30)), b("now", m(-3), null)), undefined, live);
    expect(jumps.prev?.id).toBe("old");
    expect(jumps.next).toBeNull();
  });

  it("hides the previous button when a turn shows in the left half", () => {
    expect(laneJumps(series(b("old", m(-40), m(-30)), b("early", m(-13), m(-11))), undefined, live).prev).toBeNull();
    // A turn that started before the window and runs into its left half counts too.
    expect(laneJumps(series(b("old", m(-40), m(-30)), b("long", m(-20), m(-10))), undefined, live).prev).toBeNull();
  });

  it("never offers a next turn while live: the right edge is now", () => {
    expect(laneJumps(series(b("old", m(-40), m(-30))), undefined, live).next).toBeNull();
  });

  it("offers the next turn when panned back and the right half is empty", () => {
    const jumps = laneJumps(series(b("then", m(-74), m(-70)), b("later", m(-50), m(-45))), undefined, past);
    expect(jumps.next?.id).toBe("later");
    expect(jumps.prev).toBeNull();
    expect(laneJumps(series(b("late", m(-64), m(-61)), b("later", m(-50), m(-45))), undefined, past).next).toBeNull();
  });

  it("picks the turn nearest the window on each side", () => {
    const jumps = laneJumps(
      series(b("a", m(-120), m(-110)), b("b", m(-100), m(-90)), b("c", m(-40), m(-35)), b("d", m(-30), m(-20))),
      undefined,
      past,
    );
    expect(jumps.prev?.id).toBe("b");
    expect(jumps.next?.id).toBe("c");
  });

  it("falls back to the server's neighbours for turns older than the loaded history", () => {
    const older = b("older", m(-3000), m(-2990));
    expect(laneJumps(undefined, { prev: older, next: null }, live).prev?.id).toBe("older");
    // A loaded turn is nearer than anything the server found before the loaded history.
    expect(laneJumps(series(b("loaded", m(-40), m(-30))), { prev: older, next: null }, live).prev?.id).toBe("loaded");
    // A neighbour that no longer lies outside the window is ignored.
    expect(laneJumps(undefined, { prev: b("inside", m(-10), m(-5)), next: null }, live).prev).toBeNull();
    expect(laneJumps(undefined, { prev: null, next: b("later", m(-30), m(-20)) }, past).next?.id).toBe("later");
  });
});

describe("zip landing", () => {
  const span = 15 * MINUTE;

  it("lands a previous turn with its end 70% across", () => {
    const { end, live: following } = zipLanding(b("p", m(-195), m(-190)), "prev", span, NOW);
    expect(end - span + 0.7 * span).toBe(m(-190));
    expect(following).toBe(false);
  });

  it("lands a next turn with its start 30% across", () => {
    const { end } = zipLanding(b("n", m(-200), m(-195)), "next", span, NOW);
    expect(end - span + 0.3 * span).toBe(m(-200));
  });

  it("shows the start of a turn too long to fit, 10% across", () => {
    const longPrev = zipLanding(b("p", m(-300), m(-250)), "prev", span, NOW);
    expect(longPrev.end - span + 0.1 * span).toBe(m(-300));
    const longNext = zipLanding(b("n", m(-300), m(-250)), "next", span, NOW);
    expect(longNext.end - span + 0.1 * span).toBe(m(-300));
  });

  it("follows the clock again when the landing reaches now", () => {
    expect(zipLanding(b("n", m(-6), null), "next", span, NOW)).toEqual({ end: NOW, live: true });
    expect(zipLanding(b("p", m(-12), m(-1)), "prev", span, NOW)).toEqual({ end: NOW, live: true });
  });
});

describe("jump distances", () => {
  it("reads in one unit", () => {
    expect(formatDistance(40 * MINUTE)).toBe("40m");
    expect(formatDistance(20 * 1000)).toBe("1m");
    expect(formatDistance(3 * HOUR + 10 * MINUTE)).toBe("3h");
    expect(formatDistance(2 * DAY + 3 * HOUR)).toBe("2d");
  });

  it("measures a previous turn from now and a next one from the window's edge", () => {
    expect(jumpDistance(b("p", m(-200), m(-180)), "prev", NOW, NOW)).toBe("3h ago");
    expect(jumpDistance(b("n", m(-20), m(-10)), "next", m(-60), NOW)).toBe("in 40m");
  });
});
