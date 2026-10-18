// Preferences persisted in localStorage, keyed by the plugin id so a renamed
// copy of the plugin never reads the original's state. Stored values are
// untrusted: each field is validated on its own, so one bad value falls back
// to its default without discarding the rest.
import { z } from "zod";
import type { GroupMode, LaneFilter } from "./grouping/types";
import { DEFAULT_SPAN, MAX_SPAN, MIN_SPAN } from "./time";

export const NAMES_WIDTH_MIN = 120;
export const NAMES_WIDTH_MAX = 360;

const idList = z.array(z.string().min(1).max(512)).max(2_000);

const preferencesSchema = z.object({
  groupMode: z
    .enum(["project", "section", "environment", "machine", "provider", "team", "none"])
    .catch("project"),
  filter: z.enum(["all", "active", "needs-you", "failed"]).catch("active"),
  span: z.number().min(MIN_SPAN).max(MAX_SPAN).catch(DEFAULT_SPAN),
  collapsedGroups: idList.catch([]),
  collapsedLanes: idList.catch([]),
  // Null until someone drags the column; until then the pane decides.
  namesWidthOverride: z.number().min(NAMES_WIDTH_MIN).max(NAMES_WIDTH_MAX).nullable().catch(null),
});

export interface Preferences {
  groupMode: GroupMode;
  filter: LaneFilter;
  span: number;
  collapsedGroups: readonly string[];
  collapsedLanes: readonly string[];
  namesWidthOverride: number | null;
}

/** `defaults` fill fields the stored value lacks (a surface's own starting point). */
export function parsePreferences(raw: unknown, defaults: Partial<Preferences> = {}): Preferences {
  const stored = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  return preferencesSchema.parse({ ...defaults, ...stored });
}

export function preferencesKey(pluginId: string, surface: string): string {
  return `${pluginId}:${surface}:preferences`;
}

export function readPreferences(key: string, defaults: Partial<Preferences> = {}): Preferences {
  try {
    const stored = window.localStorage.getItem(key);
    return parsePreferences(stored === null ? null : JSON.parse(stored), defaults);
  } catch {
    return parsePreferences(null, defaults);
  }
}

export function writePreferences(key: string, preferences: Preferences): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Storage full or disabled: preferences simply do not persist.
  }
}

/**
 * The names column width for a pane `paneWidth` px wide. Upstream's 168px
 * suits its 760px card. Real thread titles are longer, so titles get 120px
 * plus 18% of the pane, from 168px up to 320px: about 220px in a side panel
 * and 300px in a full pane, which holds most titles whole. It is never more
 * than half the pane, even when someone dragged it wider.
 */
export function namesColumnWidth(paneWidth: number, override: number | null): number {
  const pane = Number.isFinite(paneWidth) ? paneWidth : 1_200;
  const ceiling = Math.max(NAMES_WIDTH_MIN, Math.min(NAMES_WIDTH_MAX, Math.round(pane / 2)));
  const preferred = override ?? Math.min(320, Math.max(168, Math.round(120 + pane * 0.18)));
  return Math.min(ceiling, Math.max(NAMES_WIDTH_MIN, preferred));
}
