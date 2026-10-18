// bb Lanes timeline engine: one lane per thread, one block per agent turn
// growing into now, hand-off curves between threads, and decisions answered on
// the block. Implements `TimelineProps` from shared/view.ts.
//
// Rendering model (see controller.ts): React draws blocks against a Frame (an
// anchor time plus a culling range) in percent of the track; the controller
// slides and pans by writing transforms. Rows are virtualised; only blocks in
// the frame's range are drawn, and dense history collapses into clusters.
import { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LaneBlock } from "../../shared/model";
import type { GroupRow, LaneRow, TimelineProps } from "../../shared/view";
import { HeaderCell, JumpToNow, LaneCaptions, LineTip, RowBands, ScrubBar } from "./Chrome";
import { ViewController, type Frame } from "./controller";
import { CurveCaps, Curves } from "./Curves";
import { EmptyState } from "./EmptyState";
import { GridLines, RulerTicks, useTicks } from "./Ruler";
import { GroupStrip, LaneTrack } from "./TrackRow";
import {
  activityStrip,
  blocksInRange,
  handoffCurves,
  indexBlocks,
  layoutRows,
  rowAtOffset,
  rowIndexById,
  rowKey,
  trackItems,
  visibleRowRange,
  type ActivityStrip,
  type BlockIndex,
  type RowLayout,
  type TrackItem,
} from "./layout";
import * as nav from "./navigation";
import { BlockTooltip, DecisionPopover, type DetailState } from "./Popover";
import { UiStore } from "./store";
import {
  NAMES_DEFAULT,
  NAMES_MAX,
  NAMES_MIN,
  trapTab,
  useFreshBlocks,
  useNamesResize,
  usePrefersReducedMotion,
  useRegistrar,
  useTouchPan,
} from "./hooks";
import { withReportTitles } from "./labels";
import { LinkingStyle, cssString } from "./linking";
import { clamp, formatPointerTime, timeAtFraction } from "./time";
import "./timeline.css";

const OVERSCAN_ROWS = 6;
const STRIP_BIN_PX = 3;

type Describe = TimelineProps["describeThread"];

interface Focusable {
  navId: string;
  blockIds: readonly string[];
  rowId: string;
  start: number;
  end: number;
}

export function LanesTimeline(props: TimelineProps) {
  const { rows, handoffs, now, viewport, density, highlightedThreadId, className } = props;
  const rawId = useId();
  const uid = useMemo(() => `bl${rawId.replace(/[^a-zA-Z0-9]/g, "")}`, [rawId]);

  // Callbacks from the shell are read through a ref so memoised children
  // never re-render just because the shell passed a new function.
  const latest = useRef(props);
  latest.current = props;
  const describe = useCallback<Describe>((id) => latest.current.describeThread(id), []);
  const blocks = useMemo(() => withReportTitles(props.blocks, handoffs, describe), [props.blocks, handoffs, describe]);

  // Below 520px the names column is avatars only and each lane gains a caption line.
  const [narrow, setNarrow] = useState(false);
  const index = useMemo(() => indexBlocks(blocks), [blocks]);
  const layout = useMemo(() => layoutRows(rows, density, narrow), [rows, density, narrow]);
  const hasOpen = useMemo(() => blocks.some((b) => b.end === null), [blocks]);


  const hover = useMemo(() => new UiStore(), []);
  const selection = useMemo(() => new UiStore(), []);

  // ----- View controller and frames -----

  const [frame, setFrame] = useState<Frame | null>(null);
  const controllerRef = useRef<ViewController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new ViewController(viewport, now, {
      // A new frame re-lays every row out; render it without blocking, while
      // the current one keeps sliding by transform within its margin.
      requestFrame: () => startTransition(() => setFrame(controllerRef.current!.cutFrame())),
      commit: (next) => latest.current.onViewportChange(next),
    });
  }
  const controller = controllerRef.current;
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const historyStart = useMemo(() => blocks.reduce((min, b) => Math.min(min, b.start), Infinity), [blocks]);
  useEffect(() => {
    controller.historyStart = historyStart;
  }, [controller, historyStart]);

  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    controller.reducedMotion = reducedMotion;
    controller.kick();
  }, [controller, reducedMotion]);

  useLayoutEffect(() => {
    controller.syncNow(now);
  }, [controller, now]);

  // When the user last moved through time. Rows that come and go because the
  // window moved are not a re-flow the user asked for (see below).
  const lastTimeMove = useRef(0);
  useLayoutEffect(() => {
    controller.adopt(viewport);
    if (!viewport.live) lastTimeMove.current = performance.now();
  }, [controller, viewport.end, viewport.span, viewport.live]);

  // Open blocks end at the frame's clock time; re-cut it often enough that
  // they keep meeting the now line.
  useEffect(() => {
    if (!hasOpen) return;
    let timer = 0;
    const tick = () => {
      setFrame((f) => (f ? { ...f, now: controller.clock.read() } : f));
      timer = window.setTimeout(tick, controller.openCadence());
    };
    timer = window.setTimeout(tick, controller.openCadence());
    return () => window.clearTimeout(timer);
  }, [controller, hasOpen]);

  // ----- DOM refs and measurement -----

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rulerTrackRef = useRef<HTMLDivElement>(null);
  const hoverLineRef = useRef<HTMLDivElement>(null);
  const hoverLabelRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 0 });

  const registerMoving = useRegistrar(controller.moving);
  const registerTicks = useRegistrar(controller.ticks);
  const registerNow = useRegistrar(controller.nowPinned);

  useLayoutEffect(() => {
    const track = trackRef.current ?? rulerTrackRef.current;
    const root = rootRef.current;
    if (!root) return;
    let widthTimer = 0;
    const measure = (immediate: boolean) => {
      const width = (trackRef.current ?? rulerTrackRef.current)?.getBoundingClientRect().width ?? 0;
      setNarrow(root.getBoundingClientRect().width < 520);
      if (width <= 0) return;
      if (immediate || controller.width === 0) {
        controller.width = width;
        setFrame(controller.cutFrame());
        return;
      }
      // Clustering follows a resize once it settles; positions are already in percent.
      controller.width = width;
      window.clearTimeout(widthTimer);
      widthTimer = window.setTimeout(() => setFrame(controller.cutFrame()), 120);
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(root);
    if (track) observer.observe(track);
    return () => {
      observer.disconnect();
      window.clearTimeout(widthTimer);
    };
  }, [controller, rows.length === 0]);

  const activeFrame: Frame = frame ?? controller.frame;
  useLayoutEffect(() => {
    controller.adoptFrame(activeFrame);
  }, [controller, activeFrame]);

  // Vertical virtualisation.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setScroll((s) =>
        s.top === scroller.scrollTop && s.height === scroller.clientHeight
          ? s
          : { top: scroller.scrollTop, height: scroller.clientHeight },
      );
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(read);
    };
    read();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [rows.length === 0]);

  const rulerHeight = 30;
  const range = useMemo(() => {
    const top = Math.max(0, scroll.top - rulerHeight);
    const height = scroll.height || 800;
    return visibleRowRange(layout, top, top + height, OVERSCAN_ROWS);
  }, [layout, scroll]);

  // ----- Items per row -----

  const itemsCache = useRef(new Map<string, { key: string; series: unknown; items: TrackItem[] }>());
  const itemsForRow = useCallback(
    (row: LaneRow): TrackItem[] => {
      const series = index.byThread.get(row.id);
      const open = series ? series.maxEnd[series.maxEnd.length - 1] === Infinity : false;
      const openEnd = open ? activeFrame.now : 0;
      const { from, to, span, width } = activeFrame;
      const key = `${from}|${to}|${span}|${Math.round(width)}|${openEnd}`;
      const cached = itemsCache.current.get(row.id);
      if (cached && cached.key === key && cached.series === series) return cached.items;
      const items = trackItems(blocksInRange(series, from, to), span, width || 960, openEnd);
      itemsCache.current.set(row.id, { key, series, items });
      return items;
    },
    [index, activeFrame],
  );

  // A focused or open item stays drawn even when it scrolls or slides away.
  const [pinned, setPinned] = useState<Focusable | null>(null);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const openBlock = openBlockId ? (index.byId.get(openBlockId) ?? null) : null;

  const renderedRows = useMemo(() => {
    const set = new Set<number>();
    for (let i = range.first; i <= range.last; i += 1) set.add(i);
    for (const id of [pinned?.rowId, openBlock?.threadId]) {
      if (!id) continue;
      const i = rowIndexById(layout, id);
      if (i >= 0) set.add(i);
    }
    return [...set].sort((a, b) => a - b);
  }, [range, pinned, openBlock, layout]);

  const fresh = useFreshBlocks(blocks);

  // ----- Curves and strips -----

  const allCurves = useMemo(
    () => handoffCurves(handoffs, index, layout, activeFrame.from, activeFrame.to),
    [handoffs, index, layout, activeFrame.from, activeFrame.to],
  );
  // Like blocks, lines are only drawn near the rows in view: a week of
  // hand-offs across hundreds of lanes is otherwise thousands of paths.
  const curves = useMemo(() => {
    if (layout.rows.length === 0 || range.last < range.first) return allCurves;
    const top = layout.tops[range.first]!;
    const bottom = layout.tops[range.last]! + layout.heights[range.last]!;
    const y = (row: number | null) => (row === null ? null : layout.tops[row]!);
    return allCurves.filter((curve) => {
      const a = y(curve.from.row) ?? y(curve.to.row)!;
      const b = y(curve.to.row) ?? a;
      return Math.max(a, b) >= top && Math.min(a, b) <= bottom;
    });
  }, [allCurves, layout, range]);

  const stripCache = useRef(new Map<string, { key: string; index: BlockIndex; strip: ActivityStrip }>());
  const stripFor = (row: GroupRow): ActivityStrip => {
    const { from, to, span, width, now: frameNow } = activeFrame;
    const binMs = Math.max(1000, (STRIP_BIN_PX * span) / Math.max(1, width || 960));
    const openEnd = frameNow;
    const key = `${from}|${to}|${binMs}|${openEnd}|${row.threadIds.join(",")}`;
    const cached = stripCache.current.get(row.id);
    if (cached && cached.key === key && cached.index === index) return cached.strip;
    const strip = activityStrip(row.threadIds, index, from, to, binMs, openEnd);
    stripCache.current.set(row.id, { key, index, strip });
    return strip;
  };

  // ----- Rows that are re-flowing (collapse, filter, density) animate -----

  // Only a change in which rows exist or where they sit counts. The shell
  // hands over a fresh rows array on every refresh and viewport change, and
  // treating those as re-flows hid the hand-off lines while live and panning.
  // Rows that change because the window moved snap into place instead, so the
  // lines stay drawn through a pan; collapse, filter, and group changes animate.
  const rowPlacement = useMemo(
    () => layout.rows.map((row, i) => `${row.id}@${layout.tops[i]}`).join("|"),
    [layout],
  );
  const [reflowing, setReflowing] = useState(false);
  const firstPlacement = useRef(true);
  // Crossing the narrow width re-measures rows; that is a resize, not a re-flow.
  const placedNarrow = useRef(narrow);
  useLayoutEffect(() => {
    const resized = placedNarrow.current !== narrow;
    placedNarrow.current = narrow;
    if (firstPlacement.current) {
      firstPlacement.current = false;
      return;
    }
    if (resized || performance.now() - lastTimeMove.current < 600) return;
    setReflowing(true);
    const timer = window.setTimeout(() => setReflowing(false), 320);
    return () => window.clearTimeout(timer);
  }, [rowPlacement, narrow]);

  // ----- Navigation model -----

  const navModel = useCallback((): nav.NavModel => {
    const win = controller.window();
    const cache = new Map<number, nav.NavItem[]>();
    const openEnd = controller.clock.read();
    return {
      rowCount: layout.rows.length,
      from: win.from,
      to: win.to,
      itemsOf(rowIndex) {
        const hit = cache.get(rowIndex);
        if (hit) return hit;
        const row = layout.rows[rowIndex];
        let items: nav.NavItem[] = [];
        if (row?.kind === "lane") {
          const series = index.byThread.get(row.id);
          items = trackItems(series?.blocks ?? [], controller.view.span, controller.width || 960, openEnd).map(toNavItem);
        } else if (row?.kind === "group" && row.collapsed) {
          items = [{ id: `g:${row.id}`, start: win.from, end: win.to, blockIds: [] }];
        }
        cache.set(rowIndex, items);
        return items;
      },
    };
  }, [controller, layout, index]);

  // Keep the roving tab stop on something drawn, so Tab always lands in view.
  useLayoutEffect(() => {
    const state = selection.get();
    if (state.focusWithin && state.rovingId) return;
    const root = rootRef.current;
    if (state.rovingId && root?.querySelector(`[data-nav="${cssString(state.rovingId)}"]`)) return;
    const model = navModel();
    let entry: nav.NavPosition | null = null;
    for (const i of renderedRows) {
      const items = model.itemsOf(i).filter((item) => item.end > model.from && item.start < model.to);
      if (items.length > 0) {
        entry = { row: i, item: items[0]! };
        break;
      }
    }
    selection.set({
      rovingId: entry?.item.id ?? null,
      rovingRow: entry ? layout.rows[entry.row]!.id : null,
    });
  }, [renderedRows, activeFrame, layout, index, navModel, selection]);

  // Focus requests resolve after the target is drawn.
  const focusRequest = useRef<Focusable | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  useLayoutEffect(() => {
    const target = focusRequest.current;
    const root = rootRef.current;
    if (!target || !root) return;
    focusRequest.current = null;
    let el = root.querySelector<HTMLElement>(`[data-nav="${cssString(target.navId)}"]`);
    if (!el) {
      for (const id of target.blockIds) {
        el =
          root.querySelector<HTMLElement>(`[data-block="${cssString(id)}"]`) ??
          root.querySelector<HTMLElement>(`[data-members~="${cssString(id)}"]`);
        if (el) break;
      }
    }
    if (el) {
      el.focus({ preventScroll: true });
      const navId = el.dataset.nav!;
      if (navId !== target.navId) selection.set({ rovingId: navId });
    }
  }, [focusSeq, selection]);

  const scrollRowIntoView = useCallback(
    (rowIndex: number) => {
      const scroller = scrollerRef.current;
      if (!scroller || rowIndex < 0) return;
      const top = layout.tops[rowIndex]! + rulerHeight;
      const bottom = top + layout.heights[rowIndex]!;
      const viewTop = scroller.scrollTop + rulerHeight;
      const viewBottom = scroller.scrollTop + scroller.clientHeight;
      const behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
      if (top < viewTop) scroller.scrollTo({ top: top - rulerHeight - 8, behavior });
      else if (bottom > viewBottom) scroller.scrollTo({ top: bottom - scroller.clientHeight + 8, behavior });
    },
    [layout, reducedMotion],
  );

  const moveFocus = useCallback(
    (position: nav.NavPosition | null) => {
      if (!position) return false;
      const row = layout.rows[position.row]!;
      const target: Focusable = {
        navId: position.item.id,
        blockIds: position.item.blockIds,
        rowId: row.id,
        start: position.item.start,
        end: position.item.end,
      };
      if (row.kind === "lane") controller.reveal(position.item.start, position.item.end);
      scrollRowIntoView(position.row);
      selection.set({ rovingId: target.navId, rovingRow: row.id });
      setPinned(target);
      focusRequest.current = target;
      setFocusSeq((n) => n + 1);
      return true;
    },
    [layout, controller, scrollRowIntoView, selection],
  );

  // ----- Popovers -----

  const detailCache = useRef(new Map<string, DetailState>());
  const [, setDetailVersion] = useState(0);
  const detailKey = (block: LaneBlock) => `${block.id}|${block.status}|${block.end ?? ""}`;
  const detailFor = (block: LaneBlock): DetailState => detailCache.current.get(detailKey(block)) ?? { status: "loading" };
  useEffect(() => {
    if (!openBlock || openBlock.status === "waiting") return;
    const key = detailKey(openBlock);
    if (detailCache.current.has(key)) return;
    detailCache.current.set(key, { status: "loading" });
    let cancelled = false;
    latest.current.loadDetail(openBlock).then(
      (detail) => {
        detailCache.current.set(key, { status: "ready", detail });
        if (!cancelled) setDetailVersion((v) => v + 1);
      },
      () => {
        detailCache.current.set(key, { status: "error" });
        if (!cancelled) setDetailVersion((v) => v + 1);
      },
    );
    return () => {
      cancelled = true;
      // An interrupted load may be retried the next time the tooltip opens.
      if (detailCache.current.get(key)?.status === "loading") detailCache.current.delete(key);
    };
  }, [openBlock]);

  const openPopover = useCallback(
    (blockId: string | null) => {
      setOpenBlockId(blockId);
      selection.set({ openBlockId: blockId });
    },
    [selection],
  );

  // The open block can disappear: a provisional block is replaced by the real
  // turn (follow it), or the block was filtered away (close).
  useEffect(() => {
    if (!openBlockId || openBlock) return;
    const threadId = openBlockId.startsWith("live:") ? openBlockId.slice(5) : null;
    const successor = threadId ? openBlocksOf(index, threadId)[0] : undefined;
    openPopover(successor?.id ?? null);
  }, [openBlockId, openBlock, openPopover, index]);

  const focusBlockElement = useCallback((blockId: string) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-block="${cssString(blockId)}"]`)?.focus({ preventScroll: true });
  }, []);

  const closePopover = useCallback(
    (restoreFocus: boolean) => {
      const id = selection.get().openBlockId;
      openPopover(null);
      if (restoreFocus && id) focusBlockElement(id);
    },
    [openPopover, selection, focusBlockElement],
  );

  useEffect(() => {
    if (!openBlockId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(`[data-block="${cssString(openBlockId)}"], .bl-pop`)) return;
      openPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openBlockId, openPopover]);

  // Blocks open their thread at that turn, not at its latest message.
  const openThread = useCallback(
    (block: LaneBlock, split: boolean) => {
      openPopover(null);
      latest.current.onOpenThread(block.threadId, { split, seq: block.seq ?? null });
    },
    [openPopover],
  );

  const decide = useCallback(
    (block: LaneBlock, decision: "approve" | "reject") => {
      closePopover(true);
      void latest.current.onDecide(block, decision).catch(() => {
        // The shell owns rollback and the error toast.
      });
    },
    [closePopover],
  );

  // ----- Activation -----

  const activateNav = useCallback(
    (navId: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; detail?: number }) => {
      if (navId.startsWith("g:")) {
        const row = layout.rows.find((r) => r.kind === "group" && r.id === navId.slice(2));
        if (row) latest.current.onToggleRow(row);
        return;
      }
      if (navId.startsWith("c:")) {
        const blockId = navId.slice(2);
        const block = index.byId.get(blockId);
        if (!block) return;
        const item = itemsForRowById(layout, block.threadId, itemsForRow).find((i) => i.key === navId);
        if (item) controller.zoomToRange(item.start, item.end);
        return;
      }
      const block = index.byId.get(navId.slice(2));
      if (!block) return;
      // Threads open beside Lanes; ⌘/Ctrl opens one here instead.
      if (event.metaKey || event.ctrlKey) {
        openThread(block, false);
        return;
      }
      if (event.detail === 2) {
        openThread(block, true);
        return;
      }
      openPopover(selection.get().openBlockId === block.id ? null : block.id);
    },
    [layout, index, controller, itemsForRow, openThread, openPopover, selection],
  );

  // ----- Pointer: hover, drag to pan, clicks -----

  const dragState = useRef<{ id: number; x: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as Element;
    if (target.closest(".bl-item, .bl-pop, button, a, input, textarea, select")) return;
    dragState.current = { id: event.pointerId, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < 3) return;
      drag.moved = true;
      setDragging(true);
      hover.set({ hoverItem: null, hoverRow: null, hoverBlocks: null });
      controller.dragStart(drag.x, event.timeStamp);
    }
    controller.dragMove(event.clientX, event.timeStamp);
  };

  const onTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragState.current = null;
    if (drag.moved) {
      controller.dragEnd(event.timeStamp);
      setDragging(false);
    } else if (selection.get().openBlockId) {
      closePopover(false);
    }
  };

  // Touch: horizontal drags pan, vertical ones scroll the rows natively. The
  // ruler pans too, so a drag anywhere over time moves time.
  useTouchPan(trackRef, controller);
  useTouchPan(rulerTrackRef, controller);

  const hoverFrame = useRef(0);
  const lineTipRef = useRef<HTMLDivElement>(null);
  const handoffById = useMemo(() => new Map(handoffs.map((h) => [h.id, h])), [handoffs]);
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.moved || event.pointerType === "touch") return;
    const y = event.clientY;
    const canvas = event.currentTarget;
    const target = event.target as Element;
    const item = target.closest?.<HTMLElement>(".bl-item") ?? null;
    const line = item ? null : (target.closest?.(".bl-curve-hit")?.getAttribute("data-h") ?? null);
    const x = event.clientX;
    if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const offset = y - canvas.getBoundingClientRect().top;
      const rowIndex = rowAtOffset(layout, offset);
      const row = rowIndex >= 0 && offset < layout.total ? layout.rows[rowIndex] : undefined;
      const handoff = line ? handoffById.get(line) : undefined;
      if (handoff && lineTipRef.current) {
        const rect = canvas.getBoundingClientRect();
        lineTipRef.current.style.transform = `translate(${x - rect.left}px, ${offset}px)`;
      }
      hover.set({
        hoverRow: row?.id ?? null,
        hoverItem: item?.dataset.nav ?? (handoff ? `h:${handoff.id}` : null),
        hoverBlocks: item
          ? (item.dataset.members ?? item.dataset.block ?? null)
          : handoff
            ? [handoff.toBlockId, handoff.fromBlockId].filter(Boolean).join(" ")
            : null,
      });
    });
  };
  const onCanvasPointerLeave = () => {
    if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = 0;
    hover.set({ hoverRow: null, hoverItem: null, hoverBlocks: null });
  };

  const onCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const item = (event.target as Element).closest<HTMLElement>(".bl-item");
    if (!item?.dataset.nav) return;
    const row = item.closest<HTMLElement>("[data-thread], [data-group]");
    const navId = item.dataset.nav;
    selection.set({ rovingId: navId, rovingRow: row?.dataset.thread ?? row?.dataset.group ?? null });
    activateNav(navId, event);
  };

  // Wheel: horizontal pans, ⌘/Ctrl (and trackpad pinch) zooms, vertical scrolls the rows.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? controller.width : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const rect = trackRef.current?.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const fraction = rect ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 1;
        controller.zoomBy(Math.exp(clamp(dy, -80, 80) * 0.006), fraction);
        return;
      }
      if (event.shiftKey && dx === 0) {
        event.preventDefault();
        controller.panBy(dy);
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) {
        event.preventDefault();
        controller.panBy(dx);
      }
    };
    // Safari reports trackpad pinches as gesture events.
    let gestureSpan = 0;
    let gestureFraction = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureSpan = controller.view.span;
      const rect = trackRef.current?.getBoundingClientRect();
      const x = (event as unknown as { clientX: number }).clientX;
      gestureFraction = rect ? clamp((x - rect.left) / rect.width, 0, 1) : 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as unknown as { scale: number }).scale;
      if (gestureSpan > 0 && scale > 0) controller.zoomTo(gestureSpan / scale, gestureFraction);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("gesturestart", onGestureStart);
    scroller.addEventListener("gesturechange", onGestureChange);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("gesturestart", onGestureStart);
      scroller.removeEventListener("gesturechange", onGestureChange);
    };
  }, [controller, rows.length === 0]);

  // Ruler hover: the clock time under the pointer, with a guide down the lanes.
  const onRulerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const t = timeAtFraction(x / rect.width, controller.view.end, controller.view.span);
    const line = hoverLineRef.current;
    const label = hoverLabelRef.current;
    if (!line || !label) return;
    line.style.transform = `translateX(${x}px)`;
    line.dataset.show = "";
    label.textContent = formatPointerTime(t, controller.clock.read(), controller.view.span);
  };
  const onRulerPointerLeave = () => {
    if (hoverLineRef.current) delete hoverLineRef.current.dataset.show;
  };

  // ----- Keyboard -----

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const inPopover = target.closest(".bl-pop");
    const openId = selection.get().openBlockId;
    if (event.key === "Escape" && openId) {
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
      return;
    }
    if (inPopover) {
      if (event.key === "Tab" && inPopover.classList.contains("bl-ask")) trapTab(event, inPopover as HTMLElement);
      return;
    }
    if (target.matches("input, textarea, select, [contenteditable]")) return;
    const navId = target.dataset.nav;
    if (navId) {
      const model = navModel();
      const rowHint = rowIndexById(layout, selection.get().rovingRow ?? "");
      const current = nav.locate(model, navId, rowHint) ?? null;
      const handled = (() => {
        switch (event.key) {
          case "ArrowLeft":
          case "ArrowRight":
            if (current) moveFocus(nav.horizontal(model, current, event.key === "ArrowLeft" ? -1 : 1));
            return true;
          case "ArrowUp":
          case "ArrowDown":
            if (current) moveFocus(nav.vertical(model, current, event.key === "ArrowUp" ? -1 : 1));
            return true;
          case "Home":
          case "End":
            if (current) moveFocus(nav.edge(model, current, event.key === "Home" ? "first" : "last"));
            return true;
          case "Tab":
            return moveFocus(nav.tabFrom(model, current, event.shiftKey));
          case "Enter": {
            const block = navId.startsWith("b:") ? index.byId.get(navId.slice(2)) : undefined;
            if (block && (event.metaKey || event.ctrlKey)) openThread(block, false);
            else if (block && openId === block.id && block.status !== "waiting") openThread(block, !event.shiftKey);
            else activateNav(navId, { shiftKey: event.shiftKey, metaKey: false, ctrlKey: false });
            return true;
          }
          default:
            return false;
        }
      })();
      if (handled) {
        event.preventDefault();
        if (event.key !== "Enter" && openId) openPopover(null);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "[":
        controller.glideBy(-1 / 3);
        break;
      case "]":
        controller.glideBy(1 / 3);
        break;
      case "n":
      case "N":
        controller.jumpToNow();
        break;
      case "=":
      case "+":
        controller.zoomBy(0.5, 1);
        break;
      case "-":
      case "_":
        controller.zoomBy(2, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onFocusCapture = () => selection.set({ focusWithin: true });
  const onBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      selection.set({ focusWithin: false });
      setPinned(null);
    }
  };

  // ----- Names column width -----

  const [namesWidth, setNamesWidth] = useState(() => clamp(props.namesWidth ?? NAMES_DEFAULT, NAMES_MIN, NAMES_MAX));
  useEffect(() => {
    if (props.namesWidth !== undefined) setNamesWidth(clamp(props.namesWidth, NAMES_MIN, NAMES_MAX));
  }, [props.namesWidth]);
  const onNamesResize = useNamesResize(rootRef, namesWidth, (width) => {
    setNamesWidth(width);
    latest.current.onNamesWidthChange?.(width);
  });

  // ----- Summary for screen readers -----

  const waitingCount = useMemo(() => blocks.filter((b) => b.status === "waiting").length, [blocks]);
  const runningCount = useMemo(() => blocks.filter((b) => b.status === "running").length, [blocks]);

  const ticks = useTicks(activeFrame);
  const live = activeFrame.live;
  const popoverId = `${uid}-pop`;

  const rootStyle = { "--bl-names-w": `${namesWidth}px` } as CSSProperties;
  const rootProps = {
    ref: rootRef,
    className: ["bl", className].filter(Boolean).join(" "),
    "data-bl": uid,
    "data-density": density,
    "data-live": live ? "" : undefined,
    "data-dragging": dragging ? "" : undefined,
    "data-reflow": reflowing ? "" : undefined,
    "data-narrow": narrow ? "" : undefined,
    "data-scrolled": scroll.top > 0 ? "" : undefined,
    style: rootStyle,
    role: "region",
    "aria-label": "Agent lanes",
    onKeyDown,
    onFocusCapture,
    onBlurCapture,
  } as const;

  if (rows.length === 0) {
    return (
      <div {...rootProps}>
        {props.emptyState ?? (
          <EmptyState
            span={controller.view.span}
            onWiden={(span) => latest.current.onViewportChange({ end: controller.clock.read(), span, live: true })}
          />
        )}
      </div>
    );
  }

  const openRowIndex = openBlock ? rowIndexById(layout, openBlock.threadId) : -1;
  // Upstream opens above a lane in the bottom half (row ≥ rows / 2); with rows
  // that scroll, the lane's middle against the middle of the view says the same.
  const openUp =
    openRowIndex >= 0 &&
    layout.tops[openRowIndex]! + layout.heights[openRowIndex]! / 2 - Math.max(0, scroll.top - rulerHeight) >
      (scroll.height - rulerHeight) / 2;

  return (
    <div {...rootProps}>
      <LinkingStyle uid={uid} hover={hover} layout={layout} handoffs={handoffs} />
      <div className="bl-frame">
        <div ref={scrollerRef} className="bl-scroller">
          <div className="bl-ruler" aria-hidden="true">
            <div className="bl-ruler-corner" />
            <div
              ref={rulerTrackRef}
              className="bl-ruler-track"
              data-no-sidebar-swipe=""
              onPointerMove={onRulerPointerMove}
              onPointerLeave={onRulerPointerLeave}
            >
              <div className="bl-ruler-clip">
                <div ref={registerTicks} className="bl-ticks" key={live ? "live" : "history"}>
                  <RulerTicks ticks={ticks} live={live} />
                </div>
              </div>
              <div className="bl-ruler-nowclip">
                <div ref={registerNow} className="bl-now-pin">
                  <span className="bl-now-pill">now</span>
                </div>
              </div>
            </div>
          </div>
          <div
            className="bl-canvas"
            style={{ height: layout.total }}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
            onClick={onCanvasClick}
          >
            <LineTip ref={lineTipRef} hover={hover} handoffById={handoffById} describe={describe} />
            <RowBands
              layout={layout}
              renderedRows={renderedRows}
              highlightedThreadId={highlightedThreadId ?? null}
            />
            <div className="bl-names">
              {renderedRows.map((i) => (
                <HeaderCell
                  key={rowKey(layout.rows[i]!)}
                  row={layout.rows[i]!}
                  top={layout.tops[i]!}
                  height={layout.heights[i]!}
                  highlighted={highlightedThreadId === layout.rows[i]!.id}
                  hover={hover}
                  selection={selection}
                  render={latest.current.renderRowHeader}
                />
              ))}
            </div>
            <div
              ref={trackRef}
              className="bl-track"
              // bb opens its sidebar on a rightward swipe; over time it pans instead.
              data-no-sidebar-swipe=""
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              onPointerCancel={onTrackPointerUp}
            >
              <div ref={registerTicks} className="bl-grid" key={live ? "live" : "history"} aria-hidden="true">
                <GridLines ticks={ticks} live={live} />
              </div>
              <div className="bl-clip">
                <div ref={registerMoving} className="bl-layer">
                  <Curves
                    curves={curves}
                    layout={layout}
                    anchor={activeFrame.anchor}
                    span={activeFrame.span}
                    width={activeFrame.width || 960}
                    uid={uid}
                  />
                  {renderedRows.map((i) => {
                    const row = layout.rows[i]!;
                    if (row.kind === "lane") {
                      let items = itemsForRow(row);
                      if (pinned && pinned.rowId === row.id && !items.some((it) => it.key === pinned.navId)) {
                        items = withPinned(items, pinned, index);
                      }
                      return (
                        <LaneTrack
                          key={rowKey(row)}
                          row={row}
                          top={layout.tops[i]!}
                          height={layout.heights[i]!}
                          items={items}
                          anchor={activeFrame.anchor}
                          span={activeFrame.span}
                          now={activeFrame.now}
                          fresh={fresh}
                          popoverId={popoverId}
                          describe={describe}
                          selection={selection}
                          controller={controller}
                        />
                      );
                    }
                    if (!row.collapsed) return null;
                    return (
                      <GroupStrip
                        key={rowKey(row)}
                        row={row}
                        top={layout.tops[i]!}
                        height={layout.heights[i]!}
                        strip={stripFor(row)}
                        anchor={activeFrame.anchor}
                        span={activeFrame.span}
                        selection={selection}
                      />
                    );
                  })}
                  <CurveCaps curves={curves} layout={layout} anchor={activeFrame.anchor} span={activeFrame.span} />
                </div>
              </div>
              {narrow && <LaneCaptions layout={layout} renderedRows={renderedRows} describe={describe} />}
              <div className="bl-nowclip" aria-hidden="true">
                <div ref={registerNow} className="bl-now">
                  <span className="bl-now-line" />
                </div>
              </div>
              {openBlock && openRowIndex >= 0 && (
                openBlock.status === "waiting" ? (
                  <DecisionPopover
                    key={openBlock.id}
                    id={popoverId}
                    block={openBlock}
                    rowTop={layout.tops[openRowIndex]!}
                    rowHeight={layout.heights[openRowIndex]!}
                    up={openUp}
                    controller={controller}
                    describe={describe}
                    onDecide={(decision) => decide(openBlock, decision)}
                    onOpen={(split) => openThread(openBlock, split)}
                  />
                ) : (
                  <BlockTooltip
                    key={openBlock.id}
                    id={popoverId}
                    block={openBlock}
                    rowTop={layout.tops[openRowIndex]!}
                    rowHeight={layout.heights[openRowIndex]!}
                    up={openUp}
                    controller={controller}
                    now={activeFrame.now}
                    detail={detailFor(openBlock)}
                    describe={describe}
                    onOpen={(split) => openThread(openBlock, split)}
                  />
                )
              )}
            </div>
          </div>
        </div>
        {!narrow && (
          <div
            className="bl-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize lane names"
            aria-valuemin={NAMES_MIN}
            aria-valuemax={NAMES_MAX}
            aria-valuenow={namesWidth}
            tabIndex={0}
            {...onNamesResize}
          />
        )}
        <ScrubBar controller={controller} />
        <div ref={hoverLineRef} className="bl-hover-time" aria-hidden="true">
          <span ref={hoverLabelRef} className="bl-hover-label" />
        </div>
        <JumpToNow
          visible={!live}
          waiting={waitingCount}
          onJump={() => {
            controller.jumpToNow();
          }}
        />
      </div>
      <span className="bl-sr" aria-live="polite">
        {waitingCount > 0 ? `${waitingCount} need${waitingCount === 1 ? "s" : ""} you` : `${runningCount} running`}
      </span>
    </div>
  );
}

// ----- Pieces -----

function toNavItem(item: TrackItem): nav.NavItem {
  return {
    id: item.key,
    start: item.start,
    end: item.end,
    blockIds: item.kind === "block" ? [item.block.id] : item.blocks.map((b) => b.id),
  };
}

function itemsForRowById(layout: RowLayout, threadId: string, itemsForRow: (row: LaneRow) => TrackItem[]): TrackItem[] {
  const i = layout.laneRowByThread.get(threadId);
  const row = i === undefined ? undefined : layout.rows[i];
  return row?.kind === "lane" ? itemsForRow(row) : [];
}

/** Add the focused item to a row that culled it, so focus survives sliding away. */
function withPinned(items: TrackItem[], pinned: Focusable, index: BlockIndex): TrackItem[] {
  const blocks = pinned.blockIds.map((id) => index.byId.get(id)).filter((b): b is LaneBlock => b !== undefined);
  if (blocks.length === 0) return items;
  const item: TrackItem =
    blocks.length === 1
      ? { kind: "block", key: pinned.navId, block: blocks[0]!, start: pinned.start, end: pinned.end }
      : { kind: "cluster", key: pinned.navId, blocks, start: pinned.start, end: pinned.end, status: blocks[0]!.status };
  return [...items, item].sort((a, b) => a.start - b.start);
}

/** A lane's open blocks; they are its latest, so only the tail is scanned. */
function openBlocksOf(index: BlockIndex, threadId: string): LaneBlock[] {
  const series = index.byThread.get(threadId);
  if (!series || series.maxEnd[series.maxEnd.length - 1] !== Infinity) return [];
  const open: LaneBlock[] = [];
  for (let i = series.blocks.length - 1; i >= 0 && open.length < 3; i -= 1) {
    if (series.blocks[i]!.end === null) open.push(series.blocks[i]!);
    else if (open.length > 0) break;
  }
  return open;
}

