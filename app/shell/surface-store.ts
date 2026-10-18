// State shared by the pieces of one Lanes surface. The host renders a nav
// panel's title-bar content and its body as separate React trees, so the span,
// live mode, and filter they both touch live in a small module-level store
// per surface instead of React context.
import { useMemo, useSyncExternalStore } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import type { HandoffKind } from "../../shared/model";
import { DEFAULT_LINE_STYLES, type HandoffLineStyle, type RowDensity, type Viewport } from "../../shared/view";
import type { GroupMode, LaneFilter } from "./grouping/types";
import {
  NAMES_WIDTH_MAX,
  NAMES_WIDTH_MIN,
  preferencesKey,
  readPreferences,
  writePreferences,
  type Preferences,
} from "./preferences";
import { clampSpan } from "./time";

export interface SurfaceState extends Preferences {
  /** Following the clock. */
  live: boolean;
  /** Right edge of the window while not live (server time). */
  end: number;
  query: string;
  /** The toolbar's Group by menu, opened from the keyboard too. */
  groupMenuOpen: boolean;
}

/** Which surface: the full pane, or a team panel beside one thread. */
export type SurfaceKind = "lanes" | "team-lanes";

const PERSIST_DELAY_MS = 250;

/** A team panel shows a handful of related threads: all of them, as one tree. */
const SURFACE_DEFAULTS: Record<SurfaceKind, Partial<Preferences>> = {
  lanes: {},
  "team-lanes": { filter: "all", groupMode: "none" },
};

class SurfaceStore {
  private state: SurfaceState;
  private readonly listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly preferencesStorageKey: string,
    defaults: Partial<Preferences>,
  ) {
    this.state = {
      ...readPreferences(preferencesStorageKey, defaults),
      live: true,
      end: 0,
      query: "",
      groupMenuOpen: false,
    };
  }

  readonly getState = (): SurfaceState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<SurfaceState> | ((state: SurfaceState) => Partial<SurfaceState>)): void {
    const changes = typeof patch === "function" ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(changes) as (keyof SurfaceState)[]) {
      if (!Object.is(changes[key], this.state[key])) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...changes };
    this.schedulePersist();
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const { groupMode, filter, span, density, collapsedGroups, collapsedLanes, namesWidth, lineStyles } = this.state;
      writePreferences(this.preferencesStorageKey, {
        groupMode,
        filter,
        span,
        density,
        collapsedGroups,
        collapsedLanes,
        namesWidth,
        lineStyles,
      });
    }, PERSIST_DELAY_MS);
  }
}

const stores = new Map<string, SurfaceStore>();

function storeFor(pluginId: string, kind: SurfaceKind, scope: string): SurfaceStore {
  const key = `${pluginId}\u0000${kind}\u0000${scope}`;
  let store = stores.get(key);
  if (store === undefined) {
    store = new SurfaceStore(preferencesKey(pluginId, kind), SURFACE_DEFAULTS[kind]);
    stores.set(key, store);
  }
  return store;
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export interface SurfaceActions {
  setSpan(span: number): void;
  setViewport(viewport: Viewport): void;
  goLive(): void;
  setFilter(filter: LaneFilter): void;
  setGroupMode(mode: GroupMode): void;
  setQuery(query: string): void;
  setDensity(density: RowDensity): void;
  toggleGroup(id: string): void;
  toggleLane(id: string): void;
  /** Collapse or expand many groups at once ("Collapse all"). */
  setGroupsCollapsed(ids: readonly string[], collapsed: boolean): void;
  setNamesWidth(width: number): void;
  setGroupMenuOpen(open: boolean): void;
  setLineStyle(kind: HandoffKind, patch: Partial<HandoffLineStyle>): void;
  resetLineStyles(): void;
}

function bindActions(store: SurfaceStore): SurfaceActions {
  return {
    setSpan: (span) => store.update({ span: clampSpan(span) }),
    setViewport: (viewport) =>
      store.update({ span: clampSpan(viewport.span), live: viewport.live, end: viewport.end }),
    goLive: () => store.update({ live: true }),
    setFilter: (filter) => store.update({ filter }),
    setGroupMode: (groupMode) => store.update({ groupMode }),
    setQuery: (query) => store.update({ query }),
    setDensity: (density) => store.update({ density }),
    toggleGroup: (id) => store.update((state) => ({ collapsedGroups: toggled(state.collapsedGroups, id) })),
    toggleLane: (id) => store.update((state) => ({ collapsedLanes: toggled(state.collapsedLanes, id) })),
    setGroupsCollapsed: (ids, collapsed) =>
      store.update((state) => {
        const next = new Set(state.collapsedGroups);
        for (const id of ids) {
          if (collapsed) next.add(id);
          else next.delete(id);
        }
        return { collapsedGroups: [...next] };
      }),
    setNamesWidth: (width) =>
      store.update({ namesWidth: Math.round(Math.min(NAMES_WIDTH_MAX, Math.max(NAMES_WIDTH_MIN, width))) }),
    setGroupMenuOpen: (groupMenuOpen) => store.update({ groupMenuOpen }),
    setLineStyle: (kind, patch) =>
      store.update((state) => ({
        lineStyles: { ...state.lineStyles, [kind]: { ...state.lineStyles[kind], ...patch } },
      })),
    resetLineStyles: () => store.update({ lineStyles: DEFAULT_LINE_STYLES }),
  };
}

/**
 * The state and actions of one surface. `scope` separates instances of the
 * same kind, e.g. the team panels of two different threads.
 */
export function useSurface(kind: SurfaceKind, scope = ""): [SurfaceState, SurfaceActions] {
  const pluginId = experimental_usePluginId();
  const store = storeFor(pluginId, kind, scope);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const actions = useMemo(() => bindActions(store), [store]);
  return [state, actions];
}
