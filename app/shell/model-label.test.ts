import { describe, expect, it } from "vitest";
import { formatModelLabel } from "./model-label";
import { namesColumnWidth, parsePreferences } from "./preferences";
import { DAY, formatDuration, HOUR, MINUTE, presetForSpan, widerPreset } from "./time";

describe("formatModelLabel", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5[1m]", "Sonnet 5.5"],
    ["claude-haiku-4-5-20251001", "Haiku 4.5"],
    ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["gpt-6-1-sol", "GPT-6.1 Sol"],
    ["gemini-3.8-flash", "Gemini 3.8 Flash"],
    ["anthropic/claude-fable-5-1", "Fable 5.1"],
    ["o4-mini", "O4 Mini"],
  ])("%s → %s", (id, label) => {
    expect(formatModelLabel(id)).toBe(label);
  });
});

describe("time", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(4 * MINUTE)).toBe("4m");
    expect(formatDuration(HOUR + 5 * MINUTE)).toBe("1h 5m");
    expect(formatDuration(2 * DAY + 3 * HOUR)).toBe("2d 3h");
  });

  it("recognises presets and the next wider one", () => {
    expect(presetForSpan(HOUR)?.label).toBe("1h");
    expect(presetForSpan(HOUR + 10_000)).toBeNull();
    expect(widerPreset(15 * MINUTE)?.label).toBe("1h");
    expect(widerPreset(7 * DAY)).toBeNull();
  });
});

describe("parsePreferences", () => {
  it("defaults everything for missing or hostile input", () => {
    expect(parsePreferences(null)).toMatchObject({ groupMode: "project", filter: "active", span: 15 * MINUTE });
    expect(parsePreferences(["x"]).filter).toBe("active");
  });

  it("keeps valid fields when others are corrupt", () => {
    const parsed = parsePreferences({
      groupMode: "machine",
      filter: "everything",
      span: 1e15,
      collapsedGroups: ["project:a", 7],
      namesWidthOverride: 220,
      density: "compact",
    });
    expect(parsed).toMatchObject({ groupMode: "machine", filter: "active", span: 15 * MINUTE, collapsedGroups: [], namesWidthOverride: 220 });
    expect(parsed).not.toHaveProperty("density");
  });
});

describe("namesColumnWidth", () => {
  it("is roomy on a full pane and narrower on a small one", () => {
    expect(namesColumnWidth(1_400, null)).toBe(272);
    expect(namesColumnWidth(Infinity, null)).toBe(272);
    expect(namesColumnWidth(800, null)).toBe(192);
    expect(namesColumnWidth(500, null)).toBe(168);
  });

  it("honours a dragged width but never takes more than half the pane", () => {
    expect(namesColumnWidth(1_400, 320)).toBe(320);
    expect(namesColumnWidth(400, 320)).toBe(200);
    expect(namesColumnWidth(200, null)).toBe(120);
  });
});
