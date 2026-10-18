import { describe, expect, it } from "vitest";
import { edge, firstTarget, horizontal, resolve, tabFrom, vertical, type NavItem, type NavModel } from "./navigation";

const item = (id: string, start: number, end: number, blockIds = [id]): NavItem => ({ id: `b:${id}`, start, end, blockIds });

// Window [100, 200). Row 1 has nothing in view; row 3 is a collapsed group.
const ROWS: NavItem[][] = [
  [item("a0", 20, 60), item("a1", 110, 130), item("a2", 150, 190)],
  [item("b0", 10, 40)],
  [item("c0", 95, 120), item("c1", 160, 210)],
  [{ id: "g:group", start: 100, end: 200, blockIds: [] }],
  [item("e0", 120, 125), { id: "c:e1", start: 140, end: 170, blockIds: ["e1", "e2", "e3"] }],
];
const model: NavModel = { rowCount: ROWS.length, from: 100, to: 200, itemsOf: (row) => ROWS[row] ?? [] };

describe("keyboard navigation", () => {
  it("enters on the first block in view", () => {
    expect(firstTarget(model)?.item.id).toBe("b:a1");
  });

  it("tabs block to block, lane by lane, within the window", () => {
    const order: string[] = [];
    for (let at = firstTarget(model); at; at = tabFrom(model, at, false)) order.push(at.item.id);
    expect(order).toEqual(["b:a1", "b:a2", "b:c0", "b:c1", "g:group", "b:e0", "c:e1"]);
  });

  it("shift-tabs back and leaves at the start", () => {
    const start = firstTarget(model)!;
    expect(tabFrom(model, start, true)).toBeNull();
    const last = { row: 4, item: ROWS[4]![1]! };
    expect(tabFrom(model, last, true)?.item.id).toBe("b:e0");
  });

  it("moves left and right through a lane at any time", () => {
    const at = { row: 0, item: ROWS[0]![1]! };
    expect(horizontal(model, at, -1)?.item.id).toBe("b:a0");
    expect(horizontal(model, at, 1)?.item.id).toBe("b:a2");
    expect(horizontal(model, { row: 0, item: ROWS[0]![2]! }, 1)).toBeNull();
  });

  it("moves up and down to the block at the same time, skipping empty lanes", () => {
    const a2 = { row: 0, item: ROWS[0]![2]! };
    expect(vertical(model, a2, 1)?.item.id).toBe("b:c1");
    const c0 = { row: 2, item: ROWS[2]![0]! };
    expect(vertical(model, c0, -1)?.item.id).toBe("b:a1");
    expect(vertical(model, c0, 1)?.item.id).toBe("g:group");
    expect(vertical(model, { row: 3, item: ROWS[3]![0]! }, 1)?.item.id).toBe("c:e1");
  });

  it("jumps to the first and last block in view", () => {
    const at = { row: 0, item: ROWS[0]![2]! };
    expect(edge(model, at, "first")?.item.id).toBe("b:a1");
    expect(edge(model, at, "last")?.item.id).toBe("b:a2");
  });

  it("finds a focused block again after it joins a cluster", () => {
    expect(resolve(model, "b:e2", ["e2"])?.item.id).toBe("c:e1");
    expect(resolve(model, "c:a1", ["a1"], 0)?.item.id).toBe("b:a1");
  });

  it("continues from a target that slid out of the window", () => {
    const stale = { row: 0, item: item("gone", 90, 105) };
    expect(tabFrom(model, stale, false)?.item.id).toBe("b:a1");
  });
});
