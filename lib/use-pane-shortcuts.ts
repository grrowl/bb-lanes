import { useEffect, useRef, type RefObject } from "react";

const scopes = new Map<HTMLElement, number>();
const lastPointerTarget = new WeakMap<Document, Node>();

/** Share one keyboard scope between a pane's toolbar, timeline and title bar. */
export function usePaneShortcuts(
  rootRef: RefObject<HTMLElement | null>,
  handle: (event: KeyboardEvent) => boolean,
) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scope = root.closest<HTMLElement>("[data-lanes-shortcuts]") ?? root;
    const doc = root.ownerDocument;
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    const belongs = (target: Node) => scope.contains(target) || (
      scope.dataset.lanesShortcuts === "lanes" &&
      target instanceof Element && target.closest("[data-lanes-header]") !== null
    );
    const visible = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const target = event.target;
      const overlay = target instanceof Element ? target.closest("[role='menu'], [role='dialog']") : null;
      // A menu lives in a portal. Remember its trigger so choosing an item
      // keeps keyboard ownership after the portal is removed.
      const trigger = overlay?.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => doc.getElementById(id))
        .find((element) => element?.getAttribute("aria-controls") === overlay.id);
      lastPointerTarget.set(doc, trigger ?? target);
      // Blank track, ruler and empty states must own keys too, even when a
      // previously focused turn disappeared or focus was in another pane.
      if (belongs(target) && target instanceof Element &&
          !target.closest("button, a, input, textarea, select, [contenteditable], [tabindex]:not([tabindex='-1']), [role='menu'], [role='dialog'], .bl-pop")) {
        scope.focus({ preventScroll: true });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (doc.visibilityState !== "visible" || !visible(scope)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='menu'], [role='dialog'], [role='listbox'], .bl-pop")) return;
      const active = doc.activeElement;
      if (active && active !== doc.body) {
        if (!belongs(active)) return;
      } else {
        const pointer = lastPointerTarget.get(doc);
        if (pointer?.isConnected) {
          if (!belongs(pointer)) return;
        } else if ([...scopes.keys()].filter(visible).length !== 1) return;
      }
      if (!latest.current(event)) return;
      event.preventDefault();
      // Claim only handled keys before bb's own pane/global shortcuts.
      event.stopPropagation();
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      const count = (scopes.get(scope) ?? 1) - 1;
      if (count === 0) scopes.delete(scope);
      else scopes.set(scope, count);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }, [rootRef]);
}
