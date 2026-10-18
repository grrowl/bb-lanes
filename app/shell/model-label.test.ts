import { describe, expect, it } from "vitest";
import { formatModelLabel } from "./model-label";
import { DEFAULT_LINE_STYLES } from "../../shared/view";
import { parsePreferences } from "./preferences";
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
    expect(parsePreferences(["x"]).density).toBe("comfortable");
  });

  it("keeps valid fields when others are corrupt", () => {
    const parsed = parsePreferences({
      groupMode: "machine",
      filter: "everything",
      span: 1e15,
      collapsedGroups: ["project:a", 7],
      namesWidth: 220,
    });
    expect(parsed).toMatchObject({ groupMode: "machine", filter: "active", span: 15 * MINUTE, collapsedGroups: [], namesWidth: 220 });
  });
});

describe("parsePreferences: line styles", () => {
  it("defaults both kinds when the field is missing or not an object", () => {
    expect(parsePreferences({}).lineStyles).toEqual(DEFAULT_LINE_STYLES);
    expect(parsePreferences({ lineStyles: "fancy" }).lineStyles).toEqual(DEFAULT_LINE_STYLES);
    expect(parsePreferences({ lineStyles: { spawn: 4 } }).lineStyles).toEqual(DEFAULT_LINE_STYLES);
  });

  it("keeps valid choices and resets only the bad field of a kind", () => {
    const parsed = parsePreferences({
      lineStyles: {
        spawn: { stroke: "wavy", start: "circle", end: "dot", color: "violet" },
        tell: { stroke: "dotted", start: "none", end: "laser", color: "#ff0000" },
      },
    });
    expect(parsed.lineStyles).toEqual({
      spawn: { stroke: "solid", start: "circle", end: "dot", color: "violet" },
      tell: { stroke: "dotted", start: "none", end: "arrow", color: "auto" },
    });
  });

  it("ignores unknown keys inside a style", () => {
    const parsed = parsePreferences({
      lineStyles: { spawn: { ...DEFAULT_LINE_STYLES.spawn, width: 9 }, tell: DEFAULT_LINE_STYLES.tell },
    });
    expect(parsed.lineStyles.spawn).toEqual(DEFAULT_LINE_STYLES.spawn);
  });
});
