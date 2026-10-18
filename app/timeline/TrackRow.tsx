// What a row draws in the moving layer: a lane's blocks and clusters, or a
// collapsed group's merged activity strip. Every element is positioned in
// percent of the track against the frame's anchor, so sliding never touches
// them; they re-render only when their own blocks or the frame change.
import { memo, useCallback } from "react";
import type { ViewController } from "./controller";
import type { CSSProperties } from "react";
import type { LaneBlock } from "../../shared/model";
import type { GroupRow, LaneRow } from "../../shared/view";
import { ToolGlyph } from "./glyphs";
import { blockAriaLabel, blockTitle, clusterAriaLabel, plural } from "./labels";
import { STRIP_STATES, type ActivityStrip, type ClusterItem, type TrackItem } from "./layout";
import type { UiStore } from "./store";
import { useUi } from "./store";
import { layerPercent } from "./time";

type Describe = (threadId: string) => { title: string; subtitle: string | null };

interface Placement {
  anchor: number;
  span: number;
}

function slotStyle(start: number, end: number, place: Placement, open: boolean): CSSProperties {
  const left = layerPercent(start, place.anchor, place.span);
  const width = ((end - start) / place.span) * 100;
  // Settled blocks keep a hairline gap so back-to-back turns stay distinct.
  return { left: `${left}%`, width: open ? `${width}%` : `calc(${width}% - 2px)` };
}

export interface LaneTrackProps {
  row: LaneRow;
  top: number;
  height: number;
  items: readonly TrackItem[];
  anchor: number;
  span: number;
  /** Clock time for the "so far" in open blocks' labels. */
  now: number;
  /** Ids of blocks that arrived after mount, which grow in. */
  fresh: ReadonlySet<string>;
  popoverId: string;
  describe: Describe;
  selection: UiStore;
  controller: ViewController;
}

export const LaneTrack = memo(function LaneTrack({
  row,
  top,
  height,
  items,
  anchor,
  span,
  now,
  fresh,
  popoverId,
  describe,
  selection,
  controller,
}: LaneTrackProps) {
  const place = { anchor, span };
  const roving = useUi(
    selection,
    useCallback((s) => (s.rovingRow === row.id ? s.rovingId : null), [row.id]),
  );
  const open = useUi(
    selection,
    useCallback(
      (s) => (s.openBlockId !== null && items.some((i) => i.kind === "block" && i.block.id === s.openBlockId) ? s.openBlockId : null),
      [items],
    ),
  );
  const title = describe(row.id).title;
  return (
    <ul
      className="bl-lane"
      data-thread={row.id}
      aria-label={`${title}'s turns`}
      style={{ transform: `translateY(${top}px)`, height }}
    >
      {items.map((item) =>
        item.kind === "block" ? (
          <BlockSlot
            key={item.key}
            block={item.block}
            navId={item.key}
            start={item.start}
            end={item.end}
            place={place}
            now={now}
            roving={roving === item.key}
            open={open === item.block.id}
            fresh={fresh.has(item.block.id)}
            popoverId={popoverId}
            describe={describe}
            controller={controller}
          />
        ) : (
          <ClusterSlot
            key={item.key}
            item={item}
            place={place}
            roving={roving === item.key}
            threadTitle={title}
          />
        ),
      )}
    </ul>
  );
});

interface BlockSlotProps {
  block: LaneBlock;
  navId: string;
  start: number;
  end: number;
  place: Placement;
  now: number;
  roving: boolean;
  open: boolean;
  fresh: boolean;
  popoverId: string;
  describe: Describe;
  controller: ViewController;
}

const BlockSlot = memo(
  function BlockSlot({ block, navId, start, end, place, now, roving, open, fresh, popoverId, describe, controller }: BlockSlotProps) {
    const isOpen = block.end === null;
    const sticky = useCallback(
      (el: HTMLSpanElement | null) => {
        if (!el) return;
        controller.labels.set(el, { start, end: isOpen ? Infinity : end, x: 0 });
        controller.touchLabels();
        return () => {
          controller.labels.delete(el);
        };
      },
      [controller, start, end, isOpen],
    );
    return (
      <li
        className="bl-slot"
        data-status={block.status}
        data-fresh={fresh ? "" : undefined}
        style={slotStyle(start, end, place, isOpen)}
      >
        <button
          type="button"
          className="bl-block bl-item"
          data-nav={navId}
          data-block={block.id}
          data-status={block.status}
          data-open={open ? "" : undefined}
          tabIndex={roving ? 0 : -1}
          aria-label={blockAriaLabel(block, now, describe)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
        >
          <span ref={sticky} className="bl-content">
            {block.tools.length > 0 && (
              <span className="bl-tools" aria-hidden="true">
                {block.tools.slice(0, 3).map((kind) => (
                  <span key={kind} className="bl-tool">
                    <ToolGlyph kind={kind} />
                  </span>
                ))}
              </span>
            )}
            <span className="bl-label">{blockTitle(block, describe)}</span>
          </span>
        </button>
        {block.status === "waiting" && (
          <span className="bl-flag" aria-hidden="true">
            <span className="bl-flag-mark">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1.8 10.8 10H1.2L6 1.8Z" fill="currentColor" />
              </svg>
              Needs you
            </span>
          </span>
        )}
      </li>
    );
  },
  (a, b) =>
    a.block === b.block &&
    a.navId === b.navId &&
    a.start === b.start &&
    a.end === b.end &&
    a.place.anchor === b.place.anchor &&
    a.place.span === b.place.span &&
    a.roving === b.roving &&
    a.open === b.open &&
    a.fresh === b.fresh &&
    a.popoverId === b.popoverId &&
    a.controller === b.controller &&
    // Only open blocks say how long they have been going.
    (a.block.end !== null || a.now === b.now),
);

interface ClusterSlotProps {
  item: ClusterItem;
  place: Placement;
  roving: boolean;
  threadTitle: string;
}

const ClusterSlot = memo(function ClusterSlot({ item, place, roving, threadTitle }: ClusterSlotProps) {
  const members = item.blocks.map((b) => b.id).join(" ");
  return (
    <li className="bl-slot bl-slot--cluster" data-status={item.status} style={slotStyle(item.start, item.end, place, false)}>
      <button
        type="button"
        className="bl-cluster bl-item"
        data-nav={item.key}
        data-members={members}
        data-status={item.status}
        tabIndex={roving ? 0 : -1}
        aria-label={clusterAriaLabel(threadTitle, item.blocks.length, item.start, item.end, item.status)}
        style={{ backgroundImage: barcode(item) }}
      >
        <span className="bl-label">{item.blocks.length}</span>
      </button>
    </li>
  );
});

const BAR_COLOR: Record<LaneBlock["status"], string> = {
  done: "var(--bl-bar)",
  interrupted: "var(--bl-bar-interrupted)",
  failed: "var(--bl-bar-failed)",
  running: "var(--bl-run-edge)",
  waiting: "var(--bl-warn)",
};

/**
 * A cluster is a miniature of its turns: each member drawn where it ran, in
 * its own state's colour, over the cluster's quiet fill. Members thinner than
 * a sliver still show as one.
 */
function barcode(item: ClusterItem): string {
  const length = Math.max(1, item.end - item.start);
  const stops: string[] = [];
  let cursor = 0;
  for (const block of item.blocks) {
    const from = Math.max(cursor, ((block.start - item.start) / length) * 100);
    const to = Math.min(100, Math.max(from + 1.2, (((block.end ?? item.end) - item.start) / length) * 100));
    const color = BAR_COLOR[block.status];
    stops.push(`transparent ${from.toFixed(2)}%`, `${color} ${from.toFixed(2)}%`, `${color} ${to.toFixed(2)}%`, `transparent ${to.toFixed(2)}%`);
    cursor = to;
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// ----- Collapsed group -----

export interface GroupStripProps {
  row: GroupRow;
  top: number;
  height: number;
  strip: ActivityStrip;
  anchor: number;
  span: number;
  selection: UiStore;
}

/**
 * A collapsed group still shows the shape of its work: a centred silhouette
 * of how many lanes were busy, tinted by the most urgent state in each moment.
 * The whole strip is the disclosure button.
 */
export const GroupStrip = memo(function GroupStrip({ row, top, height, strip, anchor, span, selection }: GroupStripProps) {
  const navId = `g:${row.id}`;
  const roving = useUi(
    selection,
    useCallback((s) => s.rovingId === navId, [navId]),
  );
  const n = strip.counts.length;
  const left = layerPercent(strip.from, anchor, span);
  const width = ((n * strip.binMs) / span) * 100;
  const total = Math.max(1, row.threadIds.length);
  const paths = STRIP_STATES.map(() => [] as string[]);
  for (let i = 0; i < n; i += 1) {
    const count = strip.counts[i]!;
    if (count === 0) continue;
    // A mirrored silhouette of how many lanes were busy; sqrt keeps one busy
    // lane readable next to many.
    const h = 0.28 + 0.72 * Math.sqrt(Math.min(1, count / Math.min(total, 6)));
    const y = (1 - h) / 2;
    paths[strip.states[i]! - 1]!.push(`M${i} ${y.toFixed(3)}h1.02v${h.toFixed(3)}h-1.02z`);
  }
  const { running, waiting, failed, total: lanes } = row.counts;
  const parts = [plural(lanes, "lane")];
  if (running > 0) parts.push(`${running} running`);
  if (waiting > 0) parts.push(`${waiting} need${waiting === 1 ? "s" : ""} you`);
  if (failed > 0) parts.push(`${failed} failed`);
  return (
    <div className="bl-grouptrack" data-group={row.id} style={{ transform: `translateY(${top}px)`, height }}>
      <button
        type="button"
        className="bl-strip bl-item"
        data-nav={navId}
        data-group={row.id}
        tabIndex={roving ? 0 : -1}
        aria-expanded={false}
        aria-label={`Expand ${row.label}: ${parts.join(", ")}`}
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        <svg className="bl-wave" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" aria-hidden="true">
          {paths.map((d, s) =>
            d.length > 0 ? <path key={STRIP_STATES[s]} data-state={STRIP_STATES[s]} d={d.join("")} /> : null,
          )}
        </svg>
      </button>
    </div>
  );
});
