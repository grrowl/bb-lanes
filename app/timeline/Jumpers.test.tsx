// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LaneBlock } from "../../shared/model";
import type { Row, TimelineProps } from "../../shared/view";
import { installLayoutShims } from "../../test/layout";
import { LanesTimeline } from "./LanesTimeline";
import { MINUTE } from "./time";

beforeAll(() => {
  installTestPluginRuntime();
  installLayoutShims();
  // Reduced motion lands every glide at once, so a zip can be followed step by step.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const NOW = Date.UTC(2026, 9, 18, 12);
const m = (minutes: number) => NOW + minutes * MINUTE;
const SPAN = 15 * MINUTE;

function b(id: string, start: number, end: number | null): LaneBlock {
  return {
    id,
    threadId: "t",
    start,
    end,
    status: end === null ? "running" : "done",
    title: id,
    initiator: "user",
    source: "send",
    senderThreadId: null,
    tools: [],
    counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
    ask: null,
  };
}

const lane: Row = { kind: "lane", id: "t", depth: 0, hasChildren: false, collapsed: false, isLastChild: true, state: "idle" };

function setup(blocks: LaneBlock[], overrides: Partial<TimelineProps> = {}) {
  const props: TimelineProps = {
    rows: [lane],
    blocks,
    handoffs: [],
    now: NOW,
    viewport: { end: NOW, span: SPAN, live: true },
    onViewportChange: vi.fn(),
    density: "comfortable",
    renderRowHeader: () => <span>Lane</span>,
    onOpenThread: vi.fn(),
    onDecide: vi.fn(async () => {}),
    onToggleRow: vi.fn(),
    loadDetail: vi.fn(),
    describeThread: () => ({ title: "Lane", subtitle: null }),
    ...overrides,
  };
  const view = render(<LanesTimeline {...props} />);
  return { props, view };
}

const blockButton = (title: string) => screen.getByRole("button", { name: new RegExp(`^Lane: ${title} –`) });

describe("lane jumpers in the engine", () => {
  it("zips to a lane's previous turn, lands it 70% across, flashes and focuses it", async () => {
    const { props } = setup([b("Plan the release", m(-60), m(-55)), b("Ship it", m(-3), m(-1))]);
    const jumper = screen.getByRole("button", { name: "Jump to previous turn: Plan the release, 55m ago" });
    await act(async () => fireEvent.click(jumper));
    expect(props.onViewportChange).toHaveBeenLastCalledWith({ end: m(-55) + 0.3 * SPAN, span: SPAN, live: false });
    const landed = blockButton("Plan the release");
    expect(document.activeElement).toBe(landed);
    expect(landed.hasAttribute("data-landed")).toBe(true);
  });

  it("offers no jumper when the lane shows a turn in that half", () => {
    setup([b("Plan the release", m(-60), m(-55)), b("Early", m(-14), m(-12))]);
    expect(screen.queryByRole("button", { name: /Jump to previous turn/ })).toBeNull();
  });

  it("zips with ← from the first turn in view", async () => {
    const { props } = setup([b("Plan the release", m(-60), m(-55)), b("Ship it", m(-3), m(-1))]);
    const ship = blockButton("Ship it");
    ship.focus();
    await act(async () => fireEvent.keyDown(ship, { key: "ArrowLeft" }));
    expect(props.onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ end: m(-55) + 0.3 * SPAN, live: false }));
    expect(document.activeElement).toBe(blockButton("Plan the release"));
  });

  it("zips with → to the next turn when panned back, and never when live", async () => {
    const blocks = [b("Then", m(-58), m(-55)), b("Later", m(-20), m(-18))];
    const { props } = setup(blocks, { viewport: { end: m(-45), span: SPAN, live: false } });
    expect(screen.getByRole("button", { name: "Jump to next turn: Later, in 25m" })).toBeTruthy();
    const then = blockButton("Then");
    then.focus();
    await act(async () => fireEvent.keyDown(then, { key: "ArrowRight" }));
    expect(props.onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ end: m(-20) + 0.7 * SPAN, live: false }));
    expect(document.activeElement).toBe(blockButton("Later"));
    cleanup();
    setup(blocks);
    expect(screen.queryByRole("button", { name: /Jump to next turn/ })).toBeNull();
  });

  it("zips to a turn only the server knows, drawing it before the shell loads it", async () => {
    const far = b("Last week", m(-2995), m(-2990));
    const recent = b("Ship it", m(-3), m(-1));
    const { props, view } = setup([recent], { neighbors: { t: { prev: far, next: null } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Jump to previous turn: Last week, 2d ago$/ })));
    const landing = { end: m(-2990) + 0.3 * SPAN, span: SPAN, live: false };
    expect(props.onViewportChange).toHaveBeenLastCalledWith(landing);
    expect(document.activeElement).toBe(blockButton("Last week"));
    expect(blockButton("Last week").hasAttribute("data-landed")).toBe(true);
    // The shell then loads the window around it; the same turn simply stays.
    await act(async () => view.rerender(<LanesTimeline {...props} viewport={landing} blocks={[far, recent]} />));
    expect(document.activeElement).toBe(blockButton("Last week"));
  });

  it("opens with Enter like any button in the roving tab order", async () => {
    const { props } = setup([b("Plan the release", m(-60), m(-55)), b("Ship it", m(-3), m(-1))]);
    const jumper = screen.getByRole("button", { name: /Jump to previous turn/ });
    jumper.focus();
    await act(async () => fireEvent.keyDown(jumper, { key: "Enter" }));
    expect(props.onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ live: false }));
  });
});
