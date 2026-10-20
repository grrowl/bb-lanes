import { useMemo, useSyncExternalStore } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";

const stores = new Map<string, ReturnType<typeof createStore>>();

function createStore(key: string) {
  let openBeside = true;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (typeof stored === "boolean") openBeside = stored;
  } catch {
    // Storage can be unavailable or contain an older, invalid value.
  }
  const listeners = new Set<() => void>();
  return {
    get: () => openBeside,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: boolean) => {
      openBeside = next;
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch {
        // The preference still works for this session when storage is disabled.
      }
      for (const listener of listeners) listener();
    },
  };
}

/** One opening preference for all Lanes panes belonging to this plugin. */
export function useThreadOpening() {
  const pluginId = experimental_usePluginId();
  const store = useMemo(() => {
    const key = `${pluginId}:openBeside`;
    let existing = stores.get(key);
    if (!existing) {
      existing = createStore(key);
      stores.set(key, existing);
    }
    return existing;
  }, [pluginId]);
  return [useSyncExternalStore(store.subscribe, store.get, store.get), store.set] as const;
}
