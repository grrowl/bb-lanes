import { describe, expect, it } from "vitest";
import {
  DAY,
  HOUR,
  MAX_SPAN,
  MIN_SPAN,
  MINUTE,
  SECOND,
  absoluteTicks,
  chooseTickStep,
  formatAgo,
  formatDuration,
  isAtNow,
  layerPercent,
  layerShiftPercent,
  panWindow,
  relativeTicks,
  screenFraction,
  timeAtFraction,
  zoomWindow,
} from "./time";

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

describe("time → x", () => {
  it("puts the anchor on the right edge of an untranslated layer", () => {
    expect(layerPercent(NOW, NOW, 15 * MINUTE)).toBe(100);
    expect(layerPercent(NOW - 15 * MINUTE, NOW, 15 * MINUTE)).toBe(0);
    expect(layerShiftPercent(NOW, NOW, 15 * MINUTE)).toBeCloseTo(0);
  });

  it("slides the window by translating the layer only", () => {
    const anchor = NOW;
    const span = 15 * MINUTE;
    // Five minutes later, a block placed at the anchor sits a third of the way back.
    const end = NOW + 5 * MINUTE;
    const onScreen = layerPercent(anchor, anchor, span) + layerShiftPercent(end, anchor, span);
    expect(onScreen / 100).toBeCloseTo(screenFraction(anchor, end, span));
    expect(onScreen).toBeCloseTo(100 - 100 / 3);
  });

  it("maps fractions back to times", () => {
    expect(timeAtFraction(0.5, NOW, HOUR)).toBe(NOW - 30 * MINUTE);
    expect(screenFraction(timeAtFraction(0.25, NOW, HOUR), NOW, HOUR)).toBeCloseTo(0.25);
  });
});

describe("pan and zoom", () => {
  it("keeps the time under the pointer fixed while zooming", () => {
    const view = { end: NOW - 10 * MINUTE, span: HOUR };
    const pivot = timeAtFraction(0.4, view.end, view.span);
    const next = zoomWindow(view, 0.5, 0.4, NOW);
    expect(next.span).toBe(30 * MINUTE);
    expect(timeAtFraction(0.4, next.end, next.span)).toBeCloseTo(pivot);
  });

  it("clamps zoom to 1m … 7d and never past now", () => {
    expect(zoomWindow({ end: NOW, span: 2 * MINUTE }, 0.01, 0.5, NOW).span).toBe(MIN_SPAN);
    expect(zoomWindow({ end: NOW, span: 5 * DAY }, 10, 0.5, NOW).span).toBe(MAX_SPAN);
    expect(zoomWindow({ end: NOW - MINUTE, span: HOUR }, 2, 0, NOW).end).toBe(NOW);
  });

  it("pans by pixels and stops at now", () => {
    const view = { end: NOW - HOUR, span: HOUR };
    expect(panWindow(view, -100, 1000, NOW).end).toBe(NOW - HOUR - 6 * MINUTE);
    expect(panWindow(view, 100_000, 1000, NOW).end).toBe(NOW);
  });

  it("treats a few pixels from now as live", () => {
    expect(isAtNow(NOW - 2 * SECOND, NOW, 15 * MINUTE, 1000)).toBe(true);
    expect(isAtNow(NOW - 30 * SECOND, NOW, 15 * MINUTE, 1000)).toBe(false);
  });
});

describe("ticks", () => {
  it("adapts the step to the span and the width", () => {
    expect(chooseTickStep(15 * MINUTE, 1600)).toBe(MINUTE);
    expect(chooseTickStep(15 * MINUTE, 1200)).toBe(MINUTE);
    expect(chooseTickStep(HOUR, 1200)).toBe(5 * MINUTE);
    expect(chooseTickStep(4 * HOUR, 1200)).toBe(15 * MINUTE);
    expect(chooseTickStep(DAY, 1200)).toBe(2 * HOUR);
    expect(chooseTickStep(7 * DAY, 1200)).toBe(12 * HOUR);
    expect(chooseTickStep(15 * MINUTE, 480)).toBe(2 * MINUTE);
    // Upstream's own card: 30 minutes over a 568px track ticks every 5m, as upstream's does.
    expect(chooseTickStep(30 * MINUTE, 568)).toBe(5 * MINUTE);
    expect(chooseTickStep(30 * MINUTE, 428)).toBe(5 * MINUTE);
  });

  it("labels live ticks by age with a real minus sign", () => {
    const ticks = relativeTicks(NOW, 30 * MINUTE, 5 * MINUTE);
    expect(ticks.map((t) => t.label)).toEqual(["−5m", "−10m", "−15m", "−20m", "−25m"]);
    expect(ticks[0]!.t).toBe(NOW - 5 * MINUTE);
  });

  it("aligns history ticks to the clock", () => {
    const utc = () => 0;
    const ticks = absoluteTicks(NOW - 17 * MINUTE - 20 * SECOND, NOW, 5 * MINUTE, utc);
    expect(ticks.map((t) => new Date(t.t).toISOString().slice(11, 16))).toEqual(["11:45", "11:50", "11:55", "12:00"]);
  });
});

describe("formatting", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(40 * SECOND)).toBe("40s");
    expect(formatDuration(4 * MINUTE)).toBe("4m");
    expect(formatDuration(65 * MINUTE)).toBe("1h 5m");
    expect(formatDuration(2 * HOUR)).toBe("2h");
    expect(formatDuration(DAY + 3 * HOUR)).toBe("1d 3h");
    expect(formatAgo(30 * SECOND)).toBe("30s");
  });
});
