// A tiny external store for pointer and focus state. Hover moves constantly
// and must not re-render hundreds of blocks, so components subscribe to the
// one slice they draw (is this lane hovered, is my block the roving target).
import { useCallback, useSyncExternalStore } from "react";

export interface UiState {
  /** Row id under the pointer (lane = thread id, group = group id). */
  hoverRow: string | null;
  /** Nav id of the block or cluster under the pointer. */
  hoverItem: string | null;
  /** Block ids that item stands for, space separated. */
  hoverBlocks: string | null;
  /** Nav id that holds the roving tab stop (focused, or the entry point). */
  rovingId: string | null;
  /** Row id of the roving target. */
  rovingRow: string | null;
  /** Block id whose tooltip or decision popover is open. */
  openBlockId: string | null;
  /** True while focus is inside the timeline (the header cell shows it). */
  focusWithin: boolean;
}

export class UiStore {
  private state: UiState = {
    hoverRow: null,
    hoverItem: null,
    hoverBlocks: null,
    rovingId: null,
    rovingRow: null,
    openBlockId: null,
    focusWithin: false,
  };
  private listeners = new Set<() => void>();

  get(): UiState {
    return this.state;
  }

  set(patch: Partial<UiState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof UiState)[]) {
      if (this.state[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useUi<T>(store: UiStore, select: (state: UiState) => T): T {
  const getSnapshot = useCallback(() => select(store.get()), [store, select]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
