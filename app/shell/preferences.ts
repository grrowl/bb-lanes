// Preferences persisted in localStorage, keyed by the plugin id so a renamed
// copy of the plugin never reads the original's state. Stored values are
// untrusted: each field is validated on its own, so one bad value falls back
// to its default without discarding the rest.
import { z } from "zod";
import {
  DEFAULT_LINE_STYLES,
  type HandoffLineStyle,
  type HandoffLineStyles,
  type RowDensity,
} from "../../shared/view";
import type { GroupMode, LaneFilter } from "./grouping/types";
import { DEFAULT_SPAN, MAX_SPAN, MIN_SPAN } from "./time";

export const NAMES_WIDTH_DEFAULT = 168;
export const NAMES_WIDTH_MIN = 120;
export const NAMES_WIDTH_MAX = 360;

const idList = z.array(z.string().min(1).max(512)).max(2_000);

export const LINE_STROKES = ["solid", "dashed", "dotted"] as const;
export const LINE_START_CAPS = ["none", "dot", "circle"] as const;
export const LINE_END_CAPS = ["none", "arrow", "dot", "circle"] as const;
export const LINE_COLORS = ["auto", "neutral", "blue", "red", "amber", "green", "violet"] as const;

/** One kind's line style; a bad field falls back to that kind's default alone. */
function lineStyleSchema(fallback: HandoffLineStyle) {
  return z
    .object({
      stroke: z.enum(LINE_STROKES).catch(fallback.stroke),
      // The engine draws any cap at either end; the menu offers the useful ones.
      start: z.enum(LINE_END_CAPS).catch(fallback.start),
      end: z.enum(LINE_END_CAPS).catch(fallback.end),
      color: z.enum(LINE_COLORS).catch(fallback.color),
    })
    .catch(fallback);
}

const lineStylesSchema = z
  .object({
    spawn: lineStyleSchema(DEFAULT_LINE_STYLES.spawn),
    tell: lineStyleSchema(DEFAULT_LINE_STYLES.tell),
  })
  .catch(DEFAULT_LINE_STYLES);

const preferencesSchema = z.object({
  groupMode: z
    .enum(["project", "section", "environment", "machine", "provider", "team", "none"])
    .catch("project"),
  filter: z.enum(["all", "active", "needs-you", "failed"]).catch("active"),
  span: z.number().min(MIN_SPAN).max(MAX_SPAN).catch(DEFAULT_SPAN),
  density: z.enum(["comfortable", "compact"]).catch("comfortable"),
  collapsedGroups: idList.catch([]),
  collapsedLanes: idList.catch([]),
  namesWidth: z.number().min(NAMES_WIDTH_MIN).max(NAMES_WIDTH_MAX).catch(NAMES_WIDTH_DEFAULT),
  lineStyles: lineStylesSchema,
});

export interface Preferences {
  groupMode: GroupMode;
  filter: LaneFilter;
  span: number;
  density: RowDensity;
  collapsedGroups: readonly string[];
  collapsedLanes: readonly string[];
  namesWidth: number;
  lineStyles: HandoffLineStyles;
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
