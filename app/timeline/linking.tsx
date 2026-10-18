// Hover linking as a generated stylesheet: pointing at a block, lane or line
// lights up its hand-offs and the lanes on the other end and dims the rest,
// without re-rendering a single block.
import { useMemo } from "react";
import type { LaneHandoff } from "../../shared/model";
import { rowIndexById, type RowLayout } from "./layout";
import { useUi, type UiState, type UiStore } from "./store";

/** Escape a value for a double-quoted CSS attribute selector. */
export function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function LinkingStyle({
  uid,
  hover,
  layout,
  handoffs,
}: {
  uid: string;
  hover: UiStore;
  layout: RowLayout;
  handoffs: readonly LaneHandoff[];
}) {
  const hoverRow = useUi(hover, selectHoverRow);
  const hoverBlocks = useUi(hover, selectHoverBlocks);
  const hoverItem = useUi(hover, selectHoverItem);
  const hoverLine = hoverItem?.startsWith("h:") ? hoverItem.slice(2) : null;
  const css = useMemo(
    () => linkingCss(uid, hoverRow, hoverBlocks ? hoverBlocks.split(" ") : null, layout, handoffs, hoverLine),
    [uid, hoverRow, hoverBlocks, layout, handoffs, hoverLine],
  );
  return <style>{css}</style>;
}
const selectHoverRow = (s: UiState) => s.hoverRow;
const selectHoverBlocks = (s: UiState) => s.hoverBlocks;
const selectHoverItem = (s: UiState) => s.hoverItem;

export function linkingCss(
  uid: string,
  hoverRow: string | null,
  hoverBlocks: readonly string[] | null,
  layout: RowLayout,
  handoffs: readonly LaneHandoff[],
  hoverLine: string | null = null,
): string {
  const root = `[data-bl="${uid}"]`;
  const rules: string[] = [];
  if (hoverLine) rules.push(`${root} .bl-curve[data-h="${cssString(hoverLine)}"]{stroke-width:2px}`);
  if (hoverRow) rules.push(`${root} .bl-band[data-row="${cssString(hoverRow)}"]{background:var(--bl-hover-band)}`);
  // What is being hovered: an item's blocks, else the lane's (or group's) threads.
  const blockIds = hoverBlocks ? new Set(hoverBlocks) : null;
  let threadIds: Set<string> | null = null;
  if (!blockIds && hoverRow) {
    const row = layout.rows[rowIndexById(layout, hoverRow)];
    if (row?.kind === "lane") threadIds = new Set([row.id]);
    else if (row?.kind === "group") threadIds = new Set(row.threadIds);
  }
  if (!blockIds && !threadIds) return rules.join("");
  const linkedHandoffs: string[] = [];
  const linkedBlocks = new Set<string>(blockIds ?? []);
  const linkedThreads = new Set<string>();
  for (const h of handoffs) {
    const touches = blockIds
      ? blockIds.has(h.toBlockId) || (h.fromBlockId !== null && blockIds.has(h.fromBlockId))
      : threadIds!.has(h.fromThreadId) || threadIds!.has(h.toThreadId);
    if (!touches) continue;
    linkedHandoffs.push(h.id);
    linkedBlocks.add(h.toBlockId);
    if (h.fromBlockId) linkedBlocks.add(h.fromBlockId);
    linkedThreads.add(h.fromThreadId);
    linkedThreads.add(h.toThreadId);
  }
  // Nothing to link: leave the rest of the timeline alone rather than flicker.
  if (linkedHandoffs.length === 0) return rules.join("");
  const keep = [...linkedBlocks].flatMap((id) => [`[data-block="${cssString(id)}"]`, `[data-members~="${cssString(id)}"]`]);
  if (threadIds) for (const t of threadIds) keep.push(`[data-thread="${cssString(t)}"] *`);
  rules.push(`${root} .bl-item{opacity:var(--bl-dim)}`);
  rules.push(`${root} .bl-item:is(${keep.join(",")}){opacity:1}`);
  rules.push(`${root} :is(.bl-curve,.bl-caps){opacity:.25}`);
  const hs = linkedHandoffs.map((id) => `[data-h="${cssString(id)}"]`).join(",");
  rules.push(`${root} :is(.bl-curve,.bl-caps):is(${hs}){opacity:1}`);
  const lanes = [...linkedThreads].map((t) => `[data-row="${cssString(t)}"]`).join(",");
  rules.push(`${root} .bl-band:is(${lanes}){background:var(--bl-link-band)}`);
  return rules.join("");
}
