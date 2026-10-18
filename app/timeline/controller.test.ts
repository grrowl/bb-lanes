// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "../../shared/view";
import { ViewController } from "./controller";
import { MINUTE } from "./time";

const NOW = Date.UTC(2026, 9, 18, 12);
const SPAN = 15 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => vi.useRealTimers());

function controller() {
  const commits: Viewport[] = [];
  const moving: boolean[] = [];
  const c = new ViewController({ end: NOW, span: SPAN, live: true }, NOW, {
    requestFrame() {},
    commit: (view) => commits.push(view),
    moving: (m) => moving.push(m),
  });
  c.width = 1000;
  c.start();
  return { c, commits, moving };
}

describe("view controller", () => {
  it("zips over 420ms, reports moving meanwhile, and calls back when it lands", () => {
    const { c, commits, moving } = controller();
    const landed = vi.fn();
    c.zipTo(NOW - 30 * MINUTE, false, landed);
    expect(moving).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(landed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(moving).toEqual([true, false]);
    expect(commits.at(-1)).toEqual({ end: NOW - 30 * MINUTE, span: SPAN, live: false });
    c.stop();
  });

  it("does not restart a glide when its own commit comes back clamped to the shell's clock", () => {
    const { c, commits } = controller();
    const landed = vi.fn();
    c.zipTo(NOW - 30 * MINUTE, false, landed);
    // Leaving live is committed at once; the shell clamps the end to its slower clock.
    const leaving = commits.at(-1)!;
    expect(leaving.live).toBe(false);
    c.adopt({ ...leaving, end: leaving.end - 400 });
    vi.advanceTimersByTime(500);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(commits.at(-1)?.end).toBe(NOW - 30 * MINUTE);
    c.stop();
  });

  it("still follows a real change of window from the shell", () => {
    const { c, commits } = controller();
    c.adopt({ end: NOW - 2 * 60 * MINUTE, span: SPAN, live: false });
    vi.advanceTimersByTime(400);
    expect(c.view.end).toBe(NOW - 2 * 60 * MINUTE);
    // What it reports on arrival is the shell's own window, so nothing loops.
    expect(commits.at(-1)).toEqual({ end: NOW - 2 * 60 * MINUTE, span: SPAN, live: false });
    c.stop();
  });
});
