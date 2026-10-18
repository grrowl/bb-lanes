// The pieces around the lanes: row bands, the names column's cells, the
// hand-off chip, the scrub bar, and the jump-to-now pill.
import { forwardRef, useCallback, useRef } from "react";
import type { LaneHandoff } from "../../shared/model";
import { HANDOFF_LINES, type Row, type TimelineProps } from "../../shared/view";
import type { ViewController } from "./controller";
import { rowKey, type RowLayout } from "./layout";
import { useUi, type UiState, type UiStore } from "./store";
import { clamp, formatClock } from "./time";

type Describe = TimelineProps["describeThread"];

// Row backgrounds: separators, group bands, the highlighted thread. Hover and
// hand-off partner tints come from LinkingStyle so these never re-render on hover.
export function RowBands({
  layout,
  renderedRows,
  highlightedThreadId,
}: {
  layout: RowLayout;
  renderedRows: number[];
  highlightedThreadId: string | null;
}) {
  return (
    <div className="bl-bands" aria-hidden="true">
      {renderedRows.map((i) => {
        const row = layout.rows[i]!;
        return (
          <div
            key={rowKey(row)}
            className="bl-band"
            data-kind={row.kind}
            data-row={row.id}
            data-collapsed={row.kind === "group" && row.collapsed ? "" : undefined}
            data-first={i === 0 ? "" : undefined}
            data-highlighted={row.kind === "lane" && row.id === highlightedThreadId ? "" : undefined}
            style={{ transform: `translateY(${layout.tops[i]}px)`, height: layout.heights[i] }}
          />
        );
      })}
    </div>
  );
}

export function HeaderCell({
  row,
  top,
  height,
  highlighted,
  hover,
  selection,
  render,
}: {
  row: Row;
  top: number;
  height: number;
  highlighted: boolean;
  hover: UiStore;
  selection: UiStore;
  render: TimelineProps["renderRowHeader"];
}) {
  const hovered = useUi(
    hover,
    useCallback((s) => s.hoverRow === row.id, [row.id]),
  );
  const focused = useUi(
    selection,
    useCallback((s) => s.focusWithin && s.rovingRow === row.id, [row.id]),
  );
  return (
    <div
      className="bl-name"
      data-kind={row.kind}
      data-row={row.id}
      data-depth={row.depth}
      data-hovered={hovered ? "" : undefined}
      data-focused={focused ? "" : undefined}
      data-highlighted={highlighted ? "" : undefined}
      style={{ transform: `translateY(${top}px)`, height }}
    >
      {render(row, { hovered, focused })}
    </div>
  );
}

/** The small dark chip that names a hovered hand-off line. */
export const LineTip = forwardRef<
  HTMLDivElement,
  { hover: UiStore; handoffById: ReadonlyMap<string, LaneHandoff>; describe: Describe }
>(function LineTip({ hover, handoffById, describe }, ref) {
  const hoverItem = useUi(hover, selectHoverItem);
  const handoff = hoverItem?.startsWith("h:") ? handoffById.get(hoverItem.slice(2)) : undefined;
  return (
    <div ref={ref} className="bl-line-tip" data-show={handoff ? "" : undefined} aria-hidden="true">
      {handoff && (
        <span>
          {HANDOFF_LINES[handoff.kind].label} · {describe(handoff.fromThreadId).title} → {describe(handoff.toThreadId).title} ·{" "}
          {formatClock(handoff.at)}
        </span>
      )}
    </div>
  );
});

/**
 * Where the window sits in the loaded history, like a horizontal scrollbar:
 * drag the thumb to scrub, click the bar to glide there.
 */
export function ScrubBar({ controller }: { controller: ViewController }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const thumbRef = useCallback(
    (el: HTMLDivElement | null) => {
      controller.scrubThumb = el;
      if (el) controller.apply(controller.clock.read());
    },
    [controller],
  );
  return (
    <div
      className="bl-scrub"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const bar = event.currentTarget.getBoundingClientRect();
        if ((event.target as Element).closest(".bl-scrub-thumb")) {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: bar.width };
          event.currentTarget.dataset.dragging = "";
        } else {
          controller.scrubTo(clamp((event.clientX - bar.left) / bar.width, 0, 1));
        }
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        controller.scrubBy((event.clientX - d.x) / d.width);
        d.x = event.clientX;
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        delete event.currentTarget.dataset.dragging;
        controller.settle();
      }}
    >
      <div className="bl-scrub-rail">
        <div ref={thumbRef} className="bl-scrub-thumb" />
      </div>
    </div>
  );
}

export function JumpToNow({ visible, waiting, onJump }: { visible: boolean; waiting: number; onJump: () => void }) {
  return (
    <button
      type="button"
      className="bl-jump"
      data-visible={visible ? "" : undefined}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={onJump}
    >
      {waiting > 0 && (
        <span className="bl-jump-needs">
          <span className="bl-jump-dot" />
          {waiting} need{waiting === 1 ? "s" : ""} you
        </span>
      )}
      <span>Jump to now</span>
      <kbd>N</kbd>
    </button>
  );
}


const selectHoverItem = (s: UiState) => s.hoverItem;
