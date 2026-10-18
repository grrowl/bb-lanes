// The seam between the shell (app/shell/*) and the timeline engine
// (app/timeline/*). The shell decides WHAT rows exist and in which order
// (grouping, filtering, nesting, collapse); the engine decides WHERE things
// are drawn (time axis, rows, blocks, curves, popovers, scrolling, motion).
//
// The engine renders the names column too, so rows and tracks share one
// scroll container and can never drift apart; the shell supplies how a row's
// header cell looks through `renderRowHeader`.
import type { ReactNode } from "react";
import type { LaneBlock, LaneHandoff } from "./model";

export type RowDensity = "comfortable" | "compact";

export interface GroupRow {
  kind: "group";
  /** Stable key, e.g. "project:proj_x" or "section:sec_y". */
  id: string;
  depth: number;
  label: string;
  collapsed: boolean;
  /** Thread ids of every lane inside the group, including nested ones. */
  threadIds: string[];
  counts: { running: number; waiting: number; failed: number; total: number };
}

export interface LaneRow {
  kind: "lane";
  /** The thread id. */
  id: string;
  depth: number;
  /** Has visible child lanes under it (tree guide + disclosure). */
  hasChildren: boolean;
  collapsed: boolean;
  /** Is this the last sibling at its depth (for tree guides). */
  isLastChild: boolean;
  /**
   * Optional: thread ids hidden under this lane while it is collapsed (its
   * descendants). Hand-off curves to or from them end on this row instead of
   * fading out.
   */
  collapsedThreadIds?: string[];
  /** Live state from the sidebar, used for the lane's own idle/needs-you tag and tinting. */
  state: "idle" | "running" | "waiting" | "failed" | "queued" | "starting";
}

export type Row = GroupRow | LaneRow;

export interface Viewport {
  /** Right edge of the window (ms). Equals `now` when live. */
  end: number;
  /** Width of the window (ms). */
  span: number;
  /** Following the clock: the window slides with now. */
  live: boolean;
}

export interface TimelineProps {
  rows: Row[];
  /** Every block the shell wants drawn, any thread; the engine places them by row. */
  blocks: LaneBlock[];
  handoffs: LaneHandoff[];
  /** Current time (ms), already corrected for server clock skew. */
  now: number;
  viewport: Viewport;
  onViewportChange(next: Viewport): void;
  density: RowDensity;

  /** Draw the left names cell for a row. The engine owns its box (height, width, sticky). */
  renderRowHeader(row: Row, ctx: { hovered: boolean; focused: boolean }): ReactNode;

  /** A block was activated (click / Enter on a non-waiting block's "Open"). */
  onOpenThread(threadId: string, options: { split: boolean }): void;
  /** Inline Approve / Reject on a waiting block. */
  onDecide(block: LaneBlock, decision: "approve" | "reject"): Promise<void>;
  /** Group disclosure toggled from the engine (click on a collapsed group's summary strip). */
  onToggleRow(row: Row): void;
  /** Tooltip detail loader; the engine caches by block id. */
  loadDetail(block: LaneBlock): Promise<import("./model").BlockDetail>;
  /** Resolve a thread id to display text for tooltips, curves, and aria labels. */
  describeThread(threadId: string): { title: string; subtitle: string | null };

  /** Thread id to emphasise (e.g. the thread open in another pane). */
  highlightedThreadId?: string | null;
  className?: string;

  /**
   * Width of the names column in px (clamped to 120…360). Uncontrolled when
   * omitted. The engine renders the drag handle and reports the final width
   * of each resize through `onNamesWidthChange` so the shell can persist it.
   */
  namesWidth?: number;
  onNamesWidthChange?(width: number): void;
  /** Replaces the built-in empty state shown when `rows` is empty. */
  emptyState?: ReactNode;
}

// Hand-off lines join two lanes at the moment one thread started, messaged,
// or reported back to another: they leave the sender's lane at `handoff.at`
// (inside the reply that did it, not at the end of the block) and land on the
// start of the target block. The styles are fixed opinions, not settings: one
// look per kind, so a glance reads the same for everyone.

export type LineStroke = "solid" | "dashed" | "dotted";
/** "dot" is a filled circle, "circle" an open ring. */
export type LineCap = "none" | "dot" | "circle" | "arrow";
export type LineColor = "red" | "blue" | "neutral";

export interface HandoffLineStyle {
  /** What the line is called in tooltips and legends. */
  label: string;
  stroke: LineStroke;
  /** Cap at the sender's end (the moment in the reply). */
  start: LineCap;
  /** Cap at the target block's start. */
  end: LineCap;
  color: LineColor;
}

export const HANDOFF_LINES: Record<import("./model").HandoffKind, HandoffLineStyle> = {
  spawn: { label: "Created", stroke: "solid", start: "none", end: "dot", color: "red" },
  tell: { label: "Messaged", stroke: "dashed", start: "none", end: "arrow", color: "blue" },
  end: { label: "Ended", stroke: "solid", start: "none", end: "circle", color: "red" },
  fork: { label: "Forked", stroke: "dotted", start: "none", end: "arrow", color: "neutral" },
};
