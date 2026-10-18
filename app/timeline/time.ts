// Time-axis math for the lanes timeline. Pure functions only: everything here
// is unit tested and shared by the renderer, the gestures, and the ruler.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const MIN_SPAN = MINUTE;
export const MAX_SPAN = 7 * DAY;
/** How far back the window may be panned. */
export const MAX_HISTORY = 14 * DAY;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clampSpan(span: number): number {
  return clamp(span, MIN_SPAN, MAX_SPAN);
}

/**
 * The moving layer is positioned against a fixed anchor time `anchor`: a time
 * `t` sits at `layerPercent(t)` percent of the track width, so that with no
 * transform the anchor falls on the track's right edge. The whole layer is then
 * translated by `layerShiftPercent(end)` so the window [end - span, end] fills
 * the track. Sliding the window is therefore a transform change only.
 */
export function layerPercent(t: number, anchor: number, span: number): number {
  return ((t - anchor) / span) * 100 + 100;
}

export function layerShiftPercent(end: number, anchor: number, span: number): number {
  return (-(end - anchor) / span) * 100;
}

/** Where `t` lands on screen, as a fraction of the track width (0 = left edge, 1 = right edge). */
export function screenFraction(t: number, end: number, span: number): number {
  return (t - (end - span)) / span;
}

/** The time under a point `fraction` of the way across the track. */
export function timeAtFraction(fraction: number, end: number, span: number): number {
  return end - span + fraction * span;
}

export interface ViewWindow {
  end: number;
  span: number;
}

/**
 * Zoom by `factor` (> 1 widens the window) keeping the time under `fraction`
 * fixed on screen. The result never reaches past `now`.
 */
export function zoomWindow(
  view: ViewWindow,
  factor: number,
  fraction: number,
  now: number,
): ViewWindow {
  const span = clampSpan(view.span * factor);
  const pivot = timeAtFraction(fraction, view.end, view.span);
  const end = Math.min(now, pivot + (1 - fraction) * span);
  return { end, span };
}

/** Pan by `deltaPx` (positive moves later in time) on a track `widthPx` wide. */
export function panWindow(view: ViewWindow, deltaPx: number, widthPx: number, now: number): ViewWindow {
  const msPerPx = view.span / Math.max(1, widthPx);
  return { span: view.span, end: clampEnd(view.end + deltaPx * msPerPx, now) };
}

export function clampEnd(end: number, now: number): number {
  return clamp(end, now - MAX_HISTORY, now);
}

/** Within `px` pixels of now counts as following the clock. */
export function isAtNow(end: number, now: number, span: number, widthPx: number, px = 3): boolean {
  return now - end <= (px * span) / Math.max(1, widthPx);
}

// ----- Ticks -----

const TICK_STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
];

/** The smallest step whose labels stay at least `minSpacingPx` apart. */
export function chooseTickStep(span: number, widthPx: number, minSpacingPx = 84): number {
  const pxPerMs = Math.max(1, widthPx) / span;
  return TICK_STEPS.find((step) => step * pxPerMs >= minSpacingPx) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
}

export interface Tick {
  /** Absolute time of the tick. */
  t: number;
  label: string;
}

/**
 * Live ticks are relative to now ("−5m", "−10m") and sit at fixed offsets from
 * the right edge, so the grid stays still while the blocks slide beneath it,
 * exactly like the reference. Returned times are `now - k * step`.
 */
export function relativeTicks(now: number, span: number, step: number): Tick[] {
  const ticks: Tick[] = [];
  for (let ago = step; ago < span; ago += step) ticks.push({ t: now - ago, label: `−${formatAgo(ago)}` });
  return ticks;
}

/**
 * Historical ticks are aligned to the local clock (14:05, 14:10, Tue 12) and
 * move with the content: once the view leaves now, a time keeps its place.
 */
export function absoluteTicks(
  from: number,
  to: number,
  step: number,
  timeZoneOffset: (t: number) => number = localOffset,
): Tick[] {
  const ticks: Tick[] = [];
  // Guard against pathological ranges; a pane never needs more than this.
  for (let t = alignUp(from, step, timeZoneOffset), n = 0; t <= to && n < 500; t += step, n += 1) {
    ticks.push({ t, label: formatClockTick(t, step) });
  }
  return ticks;
}

function localOffset(t: number): number {
  return -new Date(t).getTimezoneOffset() * MINUTE;
}

function alignUp(t: number, step: number, offset: (t: number) => number): number {
  const local = t + offset(t);
  return Math.ceil(local / step) * step - offset(t);
}

// ----- Formatting -----

/** "4m", "1h 5m", "2d 3h". Seconds below a minute: "40s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / SECOND));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/** Tick labels: compact and exact at tick multiples ("30s", "5m", "1h 30m", "2d"). */
export function formatAgo(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  return formatDuration(ms);
}

/** "Last 15m", "Last 4h", "Last 7d" */
export function formatSpan(span: number): string {
  return `Last ${formatDuration(span)}`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const clockSecondsFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

export function formatClock(t: number): string {
  return clockFormat.format(t);
}

function formatClockTick(t: number, step: number): string {
  const date = new Date(t);
  const midnight = date.getHours() === 0 && date.getMinutes() === 0;
  if (step >= DAY || midnight) return dayFormat.format(date);
  return clockFormat.format(date);
}

/** The ruler's hover readout: "2:41:07 PM", with the day when it is not today. */
export function formatPointerTime(t: number, now: number, span: number): string {
  const time = span <= 2 * HOUR ? clockSecondsFormat.format(t) : clockFormat.format(t);
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${dateFormat.format(t)}, ${time}`;
}
