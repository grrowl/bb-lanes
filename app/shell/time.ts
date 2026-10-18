export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The engine zooms continuously between these bounds; presets are shortcuts. */
export const MIN_SPAN = MINUTE;
export const MAX_SPAN = 7 * DAY;
export const DEFAULT_SPAN = 15 * MINUTE;

export interface SpanPreset {
  ms: number;
  label: string;
  /** Digit key that selects it. */
  key: string;
  /** Words for the empty state and accessible names. */
  long: string;
  /** How the window menu lists it. */
  name: string;
}

export const SPAN_PRESETS: readonly SpanPreset[] = [
  { ms: 15 * MINUTE, label: "15m", key: "1", long: "15 minutes", name: "15 minutes" },
  { ms: HOUR, label: "1h", key: "2", long: "hour", name: "1 hour" },
  { ms: 4 * HOUR, label: "4h", key: "3", long: "4 hours", name: "4 hours" },
  { ms: DAY, label: "1d", key: "4", long: "day", name: "1 day" },
  { ms: 7 * DAY, label: "7d", key: "5", long: "7 days", name: "7 days" },
];

export function clampSpan(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SPAN;
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, ms));
}

/** The preset a span sits on, allowing for float drift from zoom gestures. */
export function presetForSpan(ms: number): SpanPreset | null {
  return SPAN_PRESETS.find((preset) => Math.abs(preset.ms - ms) < SECOND) ?? null;
}

/** The next wider preset, for the empty state's "widen the window" button. */
export function widerPreset(ms: number): SpanPreset | null {
  return SPAN_PRESETS.find((preset) => preset.ms > ms + SECOND) ?? null;
}

/** "45s", "4m", "1h 5m", "2d 3h" — the reference's compact duration style. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE) return `${Math.round(safe / SECOND)}s`;
  const minutes = Math.round(safe / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Human span for sentences: "Last 15m" style labels use `formatDuration`. */
export function describeSpan(ms: number): string {
  return presetForSpan(ms)?.long ?? formatDuration(ms);
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * The stretch of time on screen when the window is not following the clock:
 * "2:05 – 2:20 PM", "Tue 9:00 PM – Wed 1:00 AM", or "Oct 11 – 18".
 */
export function formatWindow(end: number, span: number): string {
  const start = end - span;
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const format = span >= 2 * DAY ? dateFormat : sameDay ? timeFormat : dayTimeFormat;
  return format.formatRange(start, end);
}
