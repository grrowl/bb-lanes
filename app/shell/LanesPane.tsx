// One Lanes surface: the tray-and-card shell around the timeline engine.
// It decides which rows exist (grouping, filters, search, collapse), feeds
// the engine live blocks, and draws every row's header cell.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import {
  experimental_useSidebarThreadActions,
  useSidebarSplitLayout,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import type { Row, RowDensity, TimelineProps, Viewport } from "../../shared/view";
import { EmptyLanes, LoadingLanes } from "./components/EmptyLanes";
import { LiveSummary } from "./components/HeaderContent";
import { GroupHeaderCell, LaneHeaderCell, type LaneActions } from "./components/RowHeader";
import { Toolbar } from "./components/Toolbar";
import { countLiveStates } from "./data/live-counts";
import { teamThreadIds } from "./data/team-scope";
import { useLanesData, useServerNow, type ProviderInfo } from "./data/useLanesData";
import { laneState, searchTerms, summarizeActivity } from "./grouping/lane-state";
import { organizeLanes } from "./grouping/organize";
import type { ThreadActivity } from "./grouping/types";
import { formatModelLabel } from "./model-label";
import { namesColumnWidth } from "./preferences";
import { useSurface, type SurfaceKind } from "./surface-store";
import { SECOND, SPAN_PRESETS } from "./time";
import "./shell.css";
import { revealTurn } from "./data/revealTurn";

/** Below this pane width the toolbar condenses into one menu. */
const CONDENSED_WIDTH = 640;
/** One density, upstream's 48px row: there is no layout setting to choose. */
const ROW_DENSITY: RowDensity = "comfortable";
/** Rows and the "in the window" test refresh on this coarse clock. */
const ROWS_CLOCK_MS = 15 * SECOND;

export interface LanesPaneProps {
  surface: SurfaceKind;
  /** Separates instances of one surface kind, e.g. one team panel per thread. */
  scope?: string;
  /** Show only this thread's team: its tree and hand-off partners. */
  teamOf?: string | null;
  Timeline: ComponentType<TimelineProps>;
}

/** How often the engine's clock ticks: often enough to look continuous at this span. */
function tickInterval(span: number): number {
  return Math.min(5 * SECOND, Math.max(250, span / 3_000));
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Pane-level keys: 1–5 pick a span, `g` opens Group by, `/` searches. They
 * stay quiet while typing and while focus is in another pane.
 */
function useLanesShortcuts(
  rootRef: RefObject<HTMLElement | null>,
  handlers: { span(ms: number): void; groupMenu(): void; search(): void },
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    // Opening the pane is itself a gesture towards it.
    let pointerInside = true;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      pointerInside =
        target !== null &&
        (rootRef.current?.contains(target) === true ||
          (target instanceof Element && target.closest("[data-lanes-header]") !== null));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const root = rootRef.current;
      if (root === null || document.visibilityState !== "visible" || root.getClientRects().length === 0) return;
      if (isEditable(event.target)) return;
      const active = document.activeElement;
      const focusInside =
        active !== null &&
        (root.contains(active) || (active instanceof Element && active.closest("[data-lanes-header]") !== null));
      const focusIdle = active === null || active === document.body;
      if (!focusInside && !(focusIdle && pointerInside)) return;

      const preset = SPAN_PRESETS.find((candidate) => candidate.key === event.key);
      if (preset !== undefined) {
        event.preventDefault();
        latest.current.span(preset.ms);
      } else if (event.key === "g") {
        event.preventDefault();
        latest.current.groupMenu();
      } else if (event.key === "/") {
        event.preventDefault();
        latest.current.search();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef]);
}

function subtitleFor(
  thread: PluginSidebarThread,
  activity: ThreadActivity | undefined,
  provider: ProviderInfo | undefined,
): string {
  const model = activity?.model ? formatModelLabel(activity.model) : (provider?.displayName ?? null);
  const place = thread.environment?.branchName ?? thread.host?.name ?? null;
  return [model, place].filter((part): part is string => part !== null && part !== "").join(" · ");
}

export function LanesPane({ surface, scope = "", teamOf = null, Timeline }: LanesPaneProps) {
  const [state, actions] = useSurface(surface, scope);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const width = useElementWidth(rootRef);
  const compactViewport = useIsCompactViewport();
  const condensed = compactViewport || width < CONDENSED_WIDTH;

  const [skew, setSkew] = useState(0);
  const rowsNow = Math.floor(useServerNow(skew, ROWS_CLOCK_MS) / ROWS_CLOCK_MS) * ROWS_CLOCK_MS;
  const viewEnd = state.live ? rowsNow : Math.min(state.end, rowsNow);
  // Load a little more than the window so a short pan back has history ready.
  const since = viewEnd - state.span * 1.25;

  const [teamIds, setTeamIds] = useState<string[] | null>(teamOf === null ? null : [teamOf]);
  const data = useLanesData({ since, threadIds: teamIds });
  useEffect(() => setSkew(data.skew), [data.skew]);

  useEffect(() => {
    if (teamOf === null) return;
    const next = [...teamThreadIds(teamOf, data.sidebar.threads, data.handoffs)].sort();
    setTeamIds((current) => (current !== null && current.join("\n") === next.join("\n") ? current : next));
  }, [teamOf, data.sidebar.threads, data.handoffs]);

  const threads = useMemo(() => {
    if (teamIds === null) return data.sidebar.threads;
    const inTeam = new Set(teamIds);
    return data.sidebar.threads.filter((thread) => inTeam.has(thread.id));
  }, [data.sidebar.threads, teamIds]);

  const providersById = useMemo(
    () => new Map(data.providers.map((provider) => [provider.id, provider])),
    [data.providers],
  );
  const providerSummaries = useMemo(
    () => data.providers.map((provider) => ({ id: provider.id, displayName: provider.displayName })),
    [data.providers],
  );

  // A lane is active if it did anything in the live window or the panned one.
  const windowStart = Math.min(rowsNow, viewEnd) - state.span;
  const activity = useMemo(
    () => summarizeActivity(data.blocks, windowStart, rowsNow),
    [data.blocks, windowStart, rowsNow],
  );

  const collapsedGroups = useMemo(() => new Set(state.collapsedGroups), [state.collapsedGroups]);
  const collapsedLanes = useMemo(() => new Set(state.collapsedLanes), [state.collapsedLanes]);
  const organized = useMemo(
    () =>
      organizeLanes({
        threads,
        projects: data.sidebar.projects,
        sections: data.sidebar.sections,
        hosts: data.sidebar.experimental_hosts ?? [],
        providers: providerSummaries,
        activity,
        mode: state.groupMode,
        filter: state.filter,
        query: state.query,
        collapsedGroups,
        collapsedLanes,
      }),
    [
      threads,
      data.sidebar.projects,
      data.sidebar.sections,
      data.sidebar.experimental_hosts,
      providerSummaries,
      activity,
      state.groupMode,
      state.filter,
      state.query,
      collapsedGroups,
      collapsedLanes,
    ],
  );

  const filterCounts = useMemo(() => {
    const counts = { waiting: 0, failed: 0 };
    for (const thread of threads) {
      if (thread.isHidden || thread.isArchived) continue;
      const state = laneState(thread, activity.get(thread.id));
      if (state === "waiting") counts.waiting += 1;
      else if (state === "failed") counts.failed += 1;
    }
    return counts;
  }, [threads, activity]);

  const groupIds = useMemo(
    () => organized.rows.filter((row) => row.kind === "group").map((row) => row.id),
    [organized.rows],
  );

  // The engine draws blocks for lanes on screen and for collapsed groups' strips.
  const shownThreads = useMemo(() => {
    const ids = new Set<string>();
    for (const row of organized.rows) {
      if (row.kind === "lane") ids.add(row.id);
      else if (row.collapsed) for (const id of row.threadIds) ids.add(id);
    }
    return ids;
  }, [organized.rows]);
  const blocks = useMemo(
    () => data.blocks.filter((block) => shownThreads.has(block.threadId)),
    [data.blocks, shownThreads],
  );
  const handoffs = useMemo(
    () => data.handoffs.filter((handoff) => shownThreads.has(handoff.fromThreadId) || shownThreads.has(handoff.toThreadId)),
    [data.handoffs, shownThreads],
  );

  const threadActions = experimental_useSidebarThreadActions();
  const laneActions = useMemo<LaneActions>(() => {
    const report = (verb: string) => (cause: unknown) =>
      toast.error(`Could not ${verb}`, { description: cause instanceof Error ? cause.message : String(cause) });
    return {
      open: (threadId, split) => threadActions.open(threadId, { split }),
      toggleGroup: actions.toggleGroup,
      toggleLane: actions.toggleLane,
      setPinned: (threadId, pinned) => {
        threadActions.setPinned(threadId, pinned).catch(report(pinned ? "pin the thread" : "unpin the thread"));
      },
      setRead: (threadId, read) => {
        threadActions.setRead(threadId, read).catch(report(read ? "mark the thread read" : "mark the thread unread"));
      },
      archive: (threadId) => threadActions.archive(threadId),
    };
  }, [threadActions, actions.toggleGroup, actions.toggleLane]);

  const splitLayout = useSidebarSplitLayout();
  const highlightedThreadId = useMemo(() => {
    if (teamOf !== null) return teamOf;
    const panes = splitLayout?.panes.filter((pane) => pane.threadId !== null) ?? [];
    return (panes.find((pane) => pane.isFocused) ?? panes[0])?.threadId ?? null;
  }, [splitLayout, teamOf]);

  const terms = useMemo(() => searchTerms(state.query), [state.query]);
  const renderRowHeader = useCallback(
    (row: Row, context: { hovered: boolean; focused: boolean }) => {
      if (row.kind === "group") {
        const meta = organized.groups.get(row.id);
        return (
          <GroupHeaderCell
            row={row}
            meta={meta}
            provider={meta?.providerId ? providersById.get(meta.providerId) : undefined}
            onToggle={() => actions.toggleGroup(row.id)}
          />
        );
      }
      const thread = data.threadsById.get(row.id);
      if (thread === undefined) return null;
      const provider = providersById.get(thread.providerId);
      return (
        <LaneHeaderCell
          row={row}
          thread={thread}
          meta={organized.lanes.get(row.id)}
          provider={provider}
          subtitle={subtitleFor(thread, activity.get(row.id), provider)}
          terms={terms}
          highlighted={row.id === highlightedThreadId}
          revealed={context.hovered || context.focused}
          actions={laneActions}
        />
      );
    },
    [organized, providersById, data.threadsById, activity, terms, highlightedThreadId, laneActions, actions],
  );

  const describeThread = useCallback(
    (threadId: string) => {
      const thread = data.threadsById.get(threadId);
      if (thread === undefined) return { title: "Another thread", subtitle: null };
      const subtitle = subtitleFor(thread, activity.get(threadId), providersById.get(thread.providerId));
      return { title: thread.displayTitle, subtitle: subtitle === "" ? null : subtitle };
    },
    [data.threadsById, activity, providersById],
  );

  const onOpenThread = useCallback(
    (threadId: string, options: { split: boolean; seq?: number | null }) => {
      threadActions.open(threadId, { split: options.split });
      if (typeof options.seq === "number") revealTurn(threadId, options.seq);
    },
    [threadActions],
  );
  const onToggleRow = useCallback(
    (row: Row) => (row.kind === "group" ? actions.toggleGroup(row.id) : actions.toggleLane(row.id)),
    [actions],
  );

  useLanesShortcuts(rootRef, {
    span: actions.setSpan,
    groupMenu: () => actions.setGroupMenuOpen(true),
    search: () => searchRef.current?.focus(),
  });

  // Beside a thread there is no title bar to carry the summary: the bar leads with the team's own.
  const teamCounts = useMemo(() => (teamOf === null ? null : countLiveStates(threads)), [teamOf, threads]);

  const loading = data.sidebar.status === "loading" || (data.status === "loading" && threads.length === 0);

  return (
    <div ref={rootRef} className="bl-theme lanes-chrome lanes-tray">
      <Toolbar
        state={state}
        actions={actions}
        counts={filterCounts}
        groupIds={groupIds}
        condensed={condensed}
        searchRef={searchRef}
        status={{ indexing: data.indexing, historyError: data.error, onRetry: data.refetch }}
        summary={teamCounts === null ? undefined : <LiveSummary counts={teamCounts} />}
      />
      <div className="lanes-card">
        {loading ? (
          <LoadingLanes />
        ) : (
          <TimelineHost
            Timeline={Timeline}
            skew={skew}
            span={state.span}
            live={state.live}
            end={state.end}
            onViewportChange={actions.setViewport}
            props={{
              rows: organized.rows,
              blocks,
              handoffs,
              density: ROW_DENSITY,
              renderRowHeader,
              onOpenThread,
              onDecide: data.decide,
              onToggleRow,
              loadDetail: data.loadDetail,
              describeThread,
              highlightedThreadId,
              namesWidth: namesColumnWidth(width, state.namesWidthOverride),
              onNamesWidthChange: actions.setNamesWidth,
              emptyState: (
                <EmptyLanes
                  span={state.span}
                  filter={state.filter}
                  query={state.query}
                  hasThreads={threads.length > 0}
                  onWiden={actions.setSpan}
                  onShowAll={() => actions.setFilter("all")}
                  onClearSearch={() => actions.setQuery("")}
                />
              ),
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Owns the fast clock so only the engine re-renders on every tick; the rows
 * and header cells above it stay memoised.
 */
function TimelineHost({
  Timeline,
  skew,
  span,
  live,
  end,
  onViewportChange,
  props,
}: {
  Timeline: ComponentType<TimelineProps>;
  skew: number;
  span: number;
  live: boolean;
  end: number;
  onViewportChange(next: Viewport): void;
  props: Omit<TimelineProps, "now" | "viewport" | "onViewportChange">;
}) {
  const now = useServerNow(skew, tickInterval(span));
  const viewport = useMemo<Viewport>(
    () => ({ span, live, end: live ? now : Math.min(end, now) }),
    [span, live, end, now],
  );
  return <Timeline {...props} now={now} viewport={viewport} onViewportChange={onViewportChange} />;
}
