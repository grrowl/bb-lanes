// Keyboard navigation over the timeline as a model, independent of the DOM:
// rows are virtualised and blocks are culled, so the next target is often not
// rendered yet. The engine asks this module for the target id, scrolls and pans
// it into view, then focuses it once it is drawn.

export interface NavItem {
  /** Nav id: "b:<blockId>", "c:<firstBlockId>" for clusters, "g:<rowId>" for a collapsed group. */
  id: string;
  start: number;
  end: number;
  /** Block ids the item stands for (one for a block, several for a cluster). */
  blockIds: readonly string[];
}

export interface NavModel {
  rowCount: number;
  /** Targets of a row in time order; empty for rows that have none. */
  itemsOf(row: number): readonly NavItem[];
  /** The visible window. Tab and ↑/↓ prefer what can be seen. */
  from: number;
  to: number;
}

export interface NavPosition {
  row: number;
  item: NavItem;
}

function inWindow(model: NavModel, item: NavItem): boolean {
  return item.end > model.from && item.start < model.to;
}

export function locate(model: NavModel, id: string, rowHint?: number): NavPosition | null {
  const scan = (row: number) => {
    const item = model.itemsOf(row).find((candidate) => candidate.id === id);
    return item ? { row, item } : null;
  };
  if (rowHint !== undefined && rowHint >= 0 && rowHint < model.rowCount) {
    const hit = scan(rowHint);
    if (hit) return hit;
  }
  for (let row = 0; row < model.rowCount; row += 1) {
    const hit = scan(row);
    if (hit) return hit;
  }
  return null;
}

/**
 * Find where a previously focused target lives now. Zooming merges blocks
 * into clusters and splits them again, so a block id may now be inside a
 * cluster, and a cluster may have dissolved into its first block.
 */
export function resolve(
  model: NavModel,
  id: string,
  blockIds: readonly string[],
  rowHint?: number,
): NavPosition | null {
  const exact = locate(model, id, rowHint);
  if (exact) return exact;
  const rows = rowHint !== undefined ? [rowHint] : [];
  for (let row = 0; row < model.rowCount; row += 1) if (row !== rowHint) rows.push(row);
  for (const row of rows) {
    if (row < 0 || row >= model.rowCount) continue;
    const item = model.itemsOf(row).find((candidate) => candidate.blockIds.some((b) => blockIds.includes(b)));
    if (item) return { row, item };
  }
  return null;
}

/** The first target in reading order: what Tab lands on when entering the timeline. */
export function firstTarget(model: NavModel): NavPosition | null {
  return tabFrom(model, null, false);
}

/**
 * Tab and Shift+Tab: target to target, lane by lane, within the visible
 * window. Returns null at either end so focus can leave the timeline.
 */
export function tabFrom(model: NavModel, current: NavPosition | null, backwards: boolean): NavPosition | null {
  const step = backwards ? -1 : 1;
  let row = current ? current.row : backwards ? model.rowCount - 1 : 0;
  let items = row >= 0 && row < model.rowCount ? model.itemsOf(row).filter((i) => inWindow(model, i)) : [];
  let index = current ? items.findIndex((i) => i.id === current.item.id) : backwards ? items.length : -1;
  if (current && index === -1) {
    // The current target slid out of the window: continue from its time.
    index = backwards
      ? items.findIndex((i) => i.start >= current.item.start)
      : findLastIndex(items, (i) => i.start <= current.item.start);
    if (backwards && index === -1) index = items.length;
  }
  for (;;) {
    const next = index + step;
    if (next >= 0 && next < items.length) return { row, item: items[next]! };
    row += step;
    if (row < 0 || row >= model.rowCount) return null;
    items = model.itemsOf(row).filter((i) => inWindow(model, i));
    index = backwards ? items.length : -1;
  }
}

/** ← / →: the previous or next target in the same lane, at any time. */
export function horizontal(model: NavModel, current: NavPosition, direction: -1 | 1): NavPosition | null {
  const items = model.itemsOf(current.row);
  const index = items.findIndex((i) => i.id === current.item.id);
  const next = items[index + direction];
  return index === -1 || !next ? null : { row: current.row, item: next };
}

/** Home / End: the first or last target of the lane that is in the window (else of the lane). */
export function edge(model: NavModel, current: NavPosition, which: "first" | "last"): NavPosition | null {
  const items = model.itemsOf(current.row);
  const visible = items.filter((i) => inWindow(model, i));
  const pool = visible.length > 0 ? visible : items;
  const item = which === "first" ? pool[0] : pool[pool.length - 1];
  return item ? { row: current.row, item } : null;
}

/**
 * ↑ / ↓: the target at the same time in the nearest lane above or below that
 * has one in the window. "Same time" is the item covering the current item's
 * midpoint, else the nearest by distance.
 */
export function vertical(model: NavModel, current: NavPosition, direction: -1 | 1): NavPosition | null {
  const mid = clampToWindow(model, (current.item.start + current.item.end) / 2);
  for (let row = current.row + direction; row >= 0 && row < model.rowCount; row += direction) {
    const items = model.itemsOf(row).filter((i) => inWindow(model, i));
    if (items.length === 0) continue;
    let best = items[0]!;
    let bestDistance = Infinity;
    for (const item of items) {
      const distance = mid < item.start ? item.start - mid : mid > item.end ? mid - item.end : 0;
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return { row, item: best };
  }
  return null;
}

function clampToWindow(model: NavModel, t: number): number {
  return Math.min(model.to, Math.max(model.from, t));
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i]!)) return i;
  return -1;
}
