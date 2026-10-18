// DOM-facing hooks for the timeline: registering transform targets with the
// controller, reduced motion, fresh-block motion, touch panning, and the
// names column's resize handle.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { LaneBlock } from "../../shared/model";
import type { ViewController } from "./controller";
import { clamp } from "./time";

export const NAMES_MIN = 120;
export const NAMES_MAX = 360;
export const NAMES_DEFAULT = 168;

export function useRegistrar(set: Set<HTMLElement>) {
  return useCallback(
    (el: HTMLElement | null) => {
      // Re-registration on remount (tick layers are keyed by mode) is handled by Set semantics.
      for (const existing of set) if (!existing.isConnected) set.delete(existing);
      if (el) set.add(el);
    },
    [set],
  );
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Block ids that arrived after the first render; they grow in rather than pop. */
export function useFreshBlocks(blocks: readonly LaneBlock[]): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY_SET);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(blocks.map((b) => b.id));
      return;
    }
    const arrived = blocks.filter((b) => !seen.current!.has(b.id)).map((b) => b.id);
    for (const id of arrived) seen.current.add(id);
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const timer = window.setTimeout(() => setFresh(EMPTY_SET), 900);
    return () => window.clearTimeout(timer);
  }, [blocks]);
  return fresh;
}
const EMPTY_SET: ReadonlySet<string> = new Set();

export function useTouchPan(ref: RefObject<HTMLDivElement | null>, controller: ViewController) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { id: number; x: number; y: number; panning: boolean } | null = null;
    const pinch = new Map<number, number>();
    let pinchStart: { distance: number; span: number; fraction: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      pinch.set(event.pointerId, event.clientX);
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()] as [number, number];
        const rect = el.getBoundingClientRect();
        pinchStart = {
          distance: Math.max(8, Math.abs(a - b)),
          span: controller.view.span,
          fraction: clamp(((a + b) / 2 - rect.left) / rect.width, 0, 1),
        };
        if (start?.panning) controller.dragEnd(event.timeStamp);
        start = null;
        return;
      }
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false };
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (pinch.has(event.pointerId)) pinch.set(event.pointerId, event.clientX);
      if (pinchStart && pinch.size === 2) {
        const [a, b] = [...pinch.values()] as [number, number];
        controller.zoomTo(pinchStart.span * (pinchStart.distance / Math.max(8, Math.abs(a - b))), pinchStart.fraction);
        return;
      }
      if (!start || start.id !== event.pointerId) return;
      if (!start.panning) {
        const dx = Math.abs(event.clientX - start.x);
        const dy = Math.abs(event.clientY - start.y);
        if (dx < 6 || dx < dy) return;
        start.panning = true;
        controller.dragStart(start.x, event.timeStamp);
      }
      controller.dragMove(event.clientX, event.timeStamp);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      pinch.delete(event.pointerId);
      if (pinch.size < 2) pinchStart = null;
      if (start?.id === event.pointerId) {
        if (start.panning) controller.dragEnd(event.timeStamp);
        start = null;
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [ref, controller]);
}

export function useNamesResize(
  rootRef: RefObject<HTMLDivElement | null>,
  width: number,
  onCommit: (width: number) => void,
) {
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const setVar = (w: number) => rootRef.current?.style.setProperty("--bl-names-w", `${w}px`);
  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width, current: width };
      rootRef.current?.setAttribute("data-resizing", "");
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d) return;
      d.current = Math.round(clamp(d.width + event.clientX - d.x, NAMES_MIN, NAMES_MAX));
      setVar(d.current);
    },
    onPointerUp() {
      const d = drag.current;
      drag.current = null;
      rootRef.current?.removeAttribute("data-resizing");
      if (d && d.current !== d.width) commit.current(d.current);
    },
    onDoubleClick() {
      setVar(NAMES_DEFAULT);
      commit.current(NAMES_DEFAULT);
    },
    onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      const step = event.shiftKey ? 32 : 8;
      const next =
        event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step : event.key === "Home" ? NAMES_MIN : event.key === "End" ? NAMES_MAX : null;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      const w = clamp(next, NAMES_MIN, NAMES_MAX);
      setVar(w);
      commit.current(w);
    },
  };
}

export function trapTab(event: ReactKeyboardEvent, container: HTMLElement) {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])"));
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

