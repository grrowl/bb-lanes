// The imperative half of the timeline: owns the live view (end, span, live),
// the animation loop, pan and zoom gestures, momentum, and the rubber band at
// now. React renders blocks against a `Frame` (an anchor time and a culling
// range); between frames the controller only writes transforms, so sliding
// with the clock and panning never re-lay-out a block.
import type { Viewport } from "../../shared/view";
import { ClockFollower } from "./clock";
import {
  MAX_HISTORY,
  clamp,
  clampSpan,
  isAtNow,
  layerShiftPercent,
  screenFraction,
  zoomWindow,
} from "./time";

export interface Frame {
  /** Anchor time the moving layer is laid out against. */
  anchor: number;
  /** Span the layer is laid out at. */
  span: number;
  /** Culling range: blocks overlapping [from, to) are drawn. */
  from: number;
  to: number;
  /** Track width in px when the frame was cut (for clustering and curve pull). */
  width: number;
  /** Clock time the frame was cut at; open blocks reach a little past it. */
  now: number;
  /** Follow the clock: the grid stays still and ticks read "−5m". */
  live: boolean;
}

export interface ControllerHost {
  /** Ask React for a new frame against the current view. */
  requestFrame(): void;
  /** Report the view to the shell (already throttled). */
  commit(view: Viewport): void;
}

type Motion =
  | { kind: "momentum"; velocity: number; last: number }
  | {
      kind: "tween";
      start: number;
      duration: number;
      fromEnd: number;
      fromSpan: number;
      toEnd: number | "now";
      toSpan: number;
      live: boolean;
    }
  | { kind: "spring"; start: number; from: number };

interface Drag {
  lastX: number;
  samples: { x: number; t: number }[];
}

const MOMENTUM_TAU = 325;
const TWEEN_MS = 280;
const COMMIT_THROTTLE_MS = 180;
/** Culling margin either side of the window, in spans. */
const CULL_MARGIN = 0.6;
/** Re-anchor once the view drifts this many spans from the anchor. */
const REANCHOR_DRIFT = 1.5;
/** A sticky label rests just inside the left fade. */
const STICKY_INSET_PX = 26;
/** …and keeps this much of its block in view before it is pushed out. */
const STICKY_MIN_PX = 64;

export function easeOutCubic(p: number): number {
  return 1 - (1 - p) ** 3;
}

/** iOS-style rubber band: resistance grows with distance, never passing `limit`. */
export function rubberBand(distance: number, limit: number): number {
  if (distance <= 0) return 0;
  return (1 - 1 / ((distance * 0.55) / limit + 1)) * limit;
}

export class ViewController {
  readonly clock: ClockFollower;
  view: Viewport;
  frame: Frame;
  width = 0;
  reducedMotion = false;

  /** Elements translated with the content (the block layer, historical ticks). */
  readonly moving = new Set<HTMLElement>();
  /** Tick layers: still while live, moving with the content otherwise. */
  readonly ticks = new Set<HTMLElement>();
  /** Elements pinned to the clock (now hairline, now pill, caps and flags). */
  readonly nowPinned = new Set<HTMLElement>();
  /** Called after every transform write (popover placement). */
  readonly followers = new Set<() => void>();
  /**
   * Block contents that stay readable when their block starts before the
   * window: they slide along the left edge like a sticky header.
   */
  readonly labels = new Map<HTMLElement, { start: number; end: number; x: number }>();

  private host: ControllerHost;
  private motion: Motion | null = null;
  private drag: Drag | null = null;
  /** Rubber band past now during a drag, in ms (raw and as drawn). */
  private rawOverscroll = 0;
  private overscroll = 0;
  private raf = 0;
  private idleTimer = 0;
  private framePending = false;
  private commitTimer = 0;
  private lastCommitted: Viewport | null = null;
  private lastShift = NaN;
  private lastNowShift = NaN;
  private stopped = true;
  private labelsQueued = false;

  constructor(viewport: Viewport, now: number, host: ControllerHost) {
    this.host = host;
    this.clock = new ClockFollower(now);
    const span = clampSpan(viewport.span);
    const end = viewport.live ? now : Math.min(now, viewport.end);
    this.view = { end, span, live: viewport.live };
    this.lastCommitted = { ...viewport };
    this.frame = this.cutFrame();
  }

  setHost(host: ControllerHost): void {
    this.host = host;
  }

  /** A frame for the current view; React renders it. */
  cutFrame(): Frame {
    const { end, span, live } = this.view;
    return {
      anchor: end,
      span,
      from: end - span * (1 + CULL_MARGIN),
      to: end + span * CULL_MARGIN,
      width: this.width,
      now: this.clock.read(),
      live,
    };
  }

  /** React committed `frame`: sync transforms to it before paint. */
  adoptFrame(frame: Frame): void {
    this.frame = frame;
    this.framePending = false;
    this.lastShift = NaN;
    this.lastNowShift = NaN;
    this.apply(this.clock.read());
    this.kick();
  }

  /**
   * How often (real ms) to re-cut the frame while blocks are open. Open blocks
   * end at the frame's clock time, like the reference's 250ms re-render; this
   * keeps the gap between their end and the sliding now line under half a
   * pixel, and slows right down when now is off screen.
   */
  openCadence(): number {
    if (this.reducedMotion || this.width <= 0) return 1000;
    const now = this.clock.read();
    if (!this.view.live && now - this.view.end > this.view.span * 0.05) return 1000;
    const msPerHalfPx = (0.5 * this.view.span) / this.width / Math.max(0.001, this.clock.rate);
    return clamp(msPerHalfPx, 50, 1000);
  }

  setWidth(width: number): void {
    if (Math.abs(width - this.width) < 0.5) return;
    this.width = width;
    this.requestFrame();
  }

  syncNow(now: number): void {
    this.clock.sync(now);
    this.kick();
  }

  /** The shell changed the viewport (span buttons, the Live toggle). */
  adopt(viewport: Viewport): void {
    const last = this.lastCommitted;
    if (
      last &&
      last.live === viewport.live &&
      last.span === viewport.span &&
      (viewport.live || last.end === viewport.end)
    ) {
      return;
    }
    this.lastCommitted = { ...viewport };
    const span = clampSpan(viewport.span);
    if (viewport.live === this.view.live && span === this.view.span && (viewport.live || viewport.end === this.view.end)) {
      return;
    }
    this.animateTo(viewport.live ? "now" : viewport.end, span, viewport.live);
  }

  // ----- Gestures -----

  /** Pan by `px` (positive moves later in time), as from a wheel. */
  panBy(px: number): void {
    if (px === 0 || this.width <= 0) return;
    this.stopMotion();
    const now = this.clock.read();
    const end = clamp(this.view.end + px * this.msPerPx(), now - MAX_HISTORY, now);
    this.view = { ...this.view, end, live: isAtNow(end, now, this.view.span, this.width) };
    this.afterChange(false);
  }

  /** Pan by a fraction of the span with an eased glide (`[` and `]`). */
  glideBy(fraction: number): void {
    const now = this.clock.read();
    const end = clamp(this.view.end + fraction * this.view.span, now - MAX_HISTORY, now);
    const live = isAtNow(end, now, this.view.span, this.width);
    this.animateTo(live ? "now" : end, this.view.span, live);
  }

  jumpToNow(): void {
    this.animateTo("now", this.view.span, true);
  }

  /** Zoom by `factor` (> 1 widens) around a point `fraction` across the track. Live zooms around now. */
  zoomBy(factor: number, fraction: number): void {
    this.zoomTo(this.view.span * factor, fraction);
  }

  zoomTo(span: number, fraction: number): void {
    this.stopMotion();
    const now = this.clock.read();
    if (this.view.live) {
      this.view = { end: now, span: clampSpan(span), live: true };
    } else {
      const next = zoomWindow(this.view, clampSpan(span) / this.view.span, fraction, now);
      this.view = { ...next, live: isAtNow(next.end, now, next.span, this.width) };
    }
    this.afterChange(false);
  }

  /** Animated zoom to show [start, end] comfortably (a cluster, a selected range). */
  zoomToRange(start: number, end: number): void {
    const now = this.clock.read();
    const span = clampSpan(Math.max(end - start, 1) * 1.3);
    const target = Math.min(now, end + (span - (end - start)) / 2);
    const live = isAtNow(target, now, span, this.width);
    this.animateTo(live ? "now" : target, span, live);
  }

  /**
   * Bring [start, end] into view if it is not already (keyboard focus). An
   * item that fits is centred; a longer one shows its edge nearest the view.
   */
  reveal(start: number, end: number): void {
    const { span } = this.view;
    const viewEnd = this.view.end;
    const pad = span * 0.06;
    if (end > viewEnd - span + pad && start < viewEnd - pad) return;
    const now = this.clock.read();
    let target: number;
    if (end - start <= span - 2 * pad) target = (start + end) / 2 + span / 2;
    else target = start >= viewEnd ? start - pad + span : end + pad;
    target = Math.min(now, target);
    const live = isAtNow(target, now, span, this.width);
    this.animateTo(live ? "now" : target, span, live);
  }

  dragStart(x: number, t: number): void {
    this.stopMotion();
    this.drag = { lastX: x, samples: [{ x, t }] };
    if (this.view.live) {
      this.view = { ...this.view, live: false };
      this.afterChange(true);
    }
  }

  dragMove(x: number, t: number): void {
    const drag = this.drag;
    if (!drag || this.width <= 0) return;
    const dx = x - drag.lastX;
    drag.lastX = x;
    drag.samples.push({ x, t });
    while (drag.samples.length > 2 && t - drag.samples[0]!.t > 100) drag.samples.shift();
    const now = this.clock.read();
    const msPerPx = this.msPerPx();
    // Dragging the content right reveals earlier time.
    let raw = this.view.end + this.rawOverscroll - dx * msPerPx;
    raw = Math.max(raw, now - MAX_HISTORY);
    if (raw > now) {
      this.rawOverscroll = raw - now;
      this.overscroll = rubberBand(this.rawOverscroll / msPerPx, this.width * 0.5) * msPerPx;
      this.view = { ...this.view, end: now };
    } else {
      this.rawOverscroll = 0;
      this.overscroll = 0;
      this.view = { ...this.view, end: raw };
    }
    this.afterChange(false);
  }

  dragEnd(t: number): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const now = this.clock.read();
    if (this.overscroll > 0) {
      this.motion = { kind: "spring", start: performance.now(), from: this.overscroll };
      this.rawOverscroll = 0;
      this.kick();
      return;
    }
    const first = drag.samples[0]!;
    const last = drag.samples[drag.samples.length - 1]!;
    const dt = Math.max(1, last.t - first.t);
    const recent = t - last.t < 60;
    const velocity = recent ? -(last.x - first.x) / dt : 0;
    if (!this.reducedMotion && Math.abs(velocity) > 0.12) {
      this.motion = { kind: "momentum", velocity, last: performance.now() };
      this.kick();
      return;
    }
    if (isAtNow(this.view.end, now, this.view.span, this.width)) this.view = { ...this.view, end: now, live: true };
    this.afterChange(true);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // ----- Loop -----

  /** Make sure the loop is running if anything needs it. */
  kick(): void {
    if (this.stopped) return;
    const animating = this.motion !== null || this.overscroll > 0;
    if (this.raf === 0 && (animating || (this.view.live && !this.reducedMotion))) {
      this.raf = requestAnimationFrame(this.tick);
    }
    if (this.idleTimer === 0) {
      // A slow heartbeat moves the now line while panned away, and steps the
      // window under reduced motion.
      this.idleTimer = window.setInterval(() => {
        if (this.raf === 0) this.apply(this.clock.read());
      }, 1000);
    }
  }

  /** Mounted: run the loop when something needs it. */
  start(): void {
    this.stopped = false;
    this.kick();
  }

  /** Unmounted (StrictMode may start it again): stop every timer. */
  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.idleTimer);
    window.clearTimeout(this.commitTimer);
    this.raf = 0;
    this.idleTimer = 0;
    this.commitTimer = 0;
  }

  private tick = (ts: number): void => {
    this.raf = 0;
    if (this.stopped) return;
    const now = this.clock.read();
    this.stepMotion(ts, now);
    this.apply(now);
    this.kick();
  };

  private stepMotion(ts: number, now: number): void {
    const motion = this.motion;
    if (!motion) return;
    if (motion.kind === "momentum") {
      const dt = Math.min(48, ts - motion.last);
      motion.last = ts;
      const end = this.view.end + motion.velocity * dt * this.msPerPx();
      motion.velocity *= Math.exp(-dt / MOMENTUM_TAU);
      if (end >= now) {
        this.view = { ...this.view, end: now, live: true };
        this.finishMotion();
      } else {
        this.view = { ...this.view, end: Math.max(end, now - MAX_HISTORY) };
        if (Math.abs(motion.velocity) < 0.02) this.finishMotion();
      }
      return;
    }
    if (motion.kind === "spring") {
      const p = Math.min(1, (ts - motion.start) / TWEEN_MS);
      this.overscroll = motion.from * (1 - easeOutCubic(p));
      if (p >= 1) {
        this.overscroll = 0;
        this.view = { ...this.view, end: now, live: true };
        this.finishMotion();
      }
      return;
    }
    const p = Math.min(1, (ts - motion.start) / motion.duration);
    const e = easeOutCubic(p);
    const toEnd = motion.toEnd === "now" ? now : motion.toEnd;
    const span = Math.exp(Math.log(motion.fromSpan) + (Math.log(motion.toSpan) - Math.log(motion.fromSpan)) * e);
    const end = Math.min(now, motion.fromEnd + (toEnd - motion.fromEnd) * e);
    const live = p >= 1 ? motion.live : this.view.live && motion.live;
    this.view = { end, span: p >= 1 ? motion.toSpan : span, live };
    if (p >= 1) {
      if (motion.live) this.view.end = now;
      this.finishMotion();
    }
  }

  private finishMotion(): void {
    this.motion = null;
    this.afterChange(true);
  }

  private stopMotion(): void {
    if (!this.motion) return;
    if (this.motion.kind === "spring") {
      this.overscroll = 0;
      this.view = { ...this.view, end: this.clock.read(), live: true };
    }
    this.motion = null;
  }

  private animateTo(end: number | "now", span: number, live: boolean): void {
    this.stopMotion();
    if (this.reducedMotion || this.width <= 0) {
      const now = this.clock.read();
      this.view = { end: end === "now" ? now : Math.min(now, end), span, live };
      this.afterChange(true);
      return;
    }
    this.motion = {
      kind: "tween",
      start: performance.now(),
      duration: TWEEN_MS,
      fromEnd: this.view.end,
      fromSpan: this.view.span,
      toEnd: end,
      toSpan: span,
      live,
    };
    // Leaving live is reported at once; arriving is reported when the glide lands.
    if (this.view.live && !live) {
      this.view = { ...this.view, live: false };
      this.scheduleCommit(true);
    }
    this.kick();
  }

  private afterChange(settled: boolean): void {
    this.apply(this.clock.read());
    this.scheduleCommit(settled);
    this.kick();
  }

  private requestFrame(): void {
    if (this.framePending) return;
    this.framePending = true;
    this.host.requestFrame();
  }

  /** Write transforms for the current view, and ask for a new frame when it drifts out of the old one. */
  apply(now: number): void {
    if (this.view.live && !this.drag && this.motion?.kind !== "tween") this.view.end = now;
    const { anchor, span } = this.frame;
    const end = this.view.end + this.overscroll;
    const shift = layerShiftPercent(end, anchor, span);
    if (!(Math.abs(shift - this.lastShift) <= 1e-4)) {
      this.lastShift = shift;
      const transform = `translate3d(${shift}%,0,0)`;
      for (const el of this.moving) el.style.transform = transform;
      for (const el of this.ticks) el.style.transform = this.frame.live ? "" : transform;
    }
    const nowShift = ((now - end) / span) * 100;
    if (!(Math.abs(nowShift - this.lastNowShift) <= 1e-4)) {
      this.lastNowShift = nowShift;
      const transform = `translate3d(${nowShift}%,0,0)`;
      for (const el of this.nowPinned) el.style.transform = transform;
    }
    this.placeLabels(end);
    for (const follow of this.followers) follow();
    const view = this.view;
    const frame = this.frame;
    if (
      view.span !== frame.span ||
      view.live !== frame.live ||
      view.end - view.span < frame.from ||
      view.end > frame.to ||
      Math.abs(view.end - frame.anchor) > REANCHOR_DRIFT * frame.span
    ) {
      this.requestFrame();
    }
  }

  /** A sticky label mounted: place it (and any siblings) once before paint. */
  touchLabels(): void {
    if (this.labelsQueued) return;
    this.labelsQueued = true;
    queueMicrotask(() => {
      this.labelsQueued = false;
      this.placeLabels(this.view.end + this.overscroll);
    });
  }

  private placeLabels(end: number): void {
    if (this.labels.size === 0 || this.width <= 0) return;
    const { span } = this.frame;
    const pxPerMs = this.width / span;
    const edge = end - this.view.span;
    for (const [el, label] of this.labels) {
      // Past the faded left edge, and pushed out by the block's own end.
      const lead = (edge - label.start) * pxPerMs + STICKY_INSET_PX;
      let x = 0;
      if (lead > 0) x = Math.max(0, Math.min(lead, (label.end - label.start) * pxPerMs - STICKY_MIN_PX));
      x = Math.round(x * 2) / 2;
      if (x !== label.x) {
        label.x = x;
        el.style.transform = x > 0 ? `translateX(${x}px)` : "";
      }
    }
  }

  // ----- Geometry helpers for the renderer -----

  /** Screen fraction (0 = left edge, 1 = right edge) of time `t` in the current view. */
  fractionOf(t: number): number {
    return screenFraction(t, this.view.end + this.overscroll, this.frame.span);
  }

  /** The visible window now (for navigation and reveal). */
  window(): { from: number; to: number } {
    const end = this.view.end;
    return { from: end - this.view.span, to: end };
  }

  private msPerPx(): number {
    return this.view.span / Math.max(1, this.width);
  }

  private scheduleCommit(immediate: boolean): void {
    const send = () => {
      this.commitTimer = 0;
      const view: Viewport = this.view.live
        ? { end: this.clock.read(), span: this.view.span, live: true }
        : { end: this.view.end, span: this.view.span, live: false };
      const last = this.lastCommitted;
      if (last && last.live === view.live && last.span === view.span && (view.live || last.end === view.end)) return;
      this.lastCommitted = view;
      this.host.commit(view);
    };
    const liveChanged = this.lastCommitted?.live !== this.view.live;
    if (immediate || liveChanged) {
      window.clearTimeout(this.commitTimer);
      send();
    } else if (this.commitTimer === 0) {
      this.commitTimer = window.setTimeout(send, COMMIT_THROTTLE_MS);
    }
  }
}
