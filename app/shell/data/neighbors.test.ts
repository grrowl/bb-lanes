import { describe, expect, it } from "vitest";
import { makeBlock } from "../testing/fixtures";
import { MINUTE } from "../time";
import { lanesNeedingNeighbors, neighborsFrom } from "./neighbors";

const NOW = Date.UTC(2026, 9, 18, 12);
const m = (minutes: number) => NOW + minutes * MINUTE;

describe("lane neighbours", () => {
  it("asks only for lanes with no loaded turn before the window", () => {
    const blocks = [
      makeBlock({ id: "a1", threadId: "a", start: m(-40), end: m(-30) }),
      makeBlock({ id: "b1", threadId: "b", start: m(-5), end: m(-2) }),
      makeBlock({ id: "c1", threadId: "c", start: m(-40), end: null }),
    ];
    // a has an earlier turn loaded; b's only turn is inside the window; c's is still running.
    expect(lanesNeedingNeighbors(["a", "b", "c", "d"], blocks, m(-15))).toEqual(["b", "c", "d"]);
  });

  it("keeps within the RPC's limit, in row order", () => {
    expect(lanesNeedingNeighbors(["x", "y", "z"], [], m(-15), 2)).toEqual(["x", "y"]);
  });

  it("asks from a window start snapped to an eighth of the span", () => {
    const span = 16 * MINUTE;
    expect(neighborsFrom(m(-15) + 30_000, span)).toBe(m(-16));
    // Sliding with the clock inside one 2 minute step asks the same question again.
    expect(neighborsFrom(m(-15) - 30_000, span)).toBe(m(-16));
    expect(neighborsFrom(m(-14), span)).toBe(m(-14));
  });
});
