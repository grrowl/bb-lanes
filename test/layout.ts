// jsdom lays nothing out. The timeline measures its pane and observes resizes,
// so tests that render it give every element a pane-sized box and stub the
// layout APIs jsdom lacks.
import { vi } from "vitest";

export function installLayoutShims(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} }) as DOMRect,
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollTo = function scrollTo() {};
}
