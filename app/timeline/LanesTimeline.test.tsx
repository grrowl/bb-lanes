// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LaneBlock } from "../../shared/model";
import type { Row, TimelineProps } from "../../shared/view";
import { describeFixture, fixtureDetail, fixtureRows, scenario } from "./fixtures";
import { LanesTimeline } from "./LanesTimeline";
import { MINUTE } from "./time";

beforeAll(() => {
  installTestPluginRuntime();
  // jsdom lays nothing out: give every element a pane-sized box.
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
});

afterEach(cleanup);

const BASE = Date.UTC(2026, 9, 18, 6, 0);
const NOW = BASE + 2 * MINUTE;

function setup(overrides: Partial<TimelineProps> = {}) {
  const fixture = scenario(BASE, 2, { noHistory: true });
  const props: TimelineProps = {
    rows: fixtureRows(fixture),
    blocks: fixture.blocks,
    handoffs: fixture.handoffs,
    now: NOW,
    viewport: { end: NOW, span: 15 * MINUTE, live: true },
    onViewportChange: vi.fn(),
    density: "comfortable",
    renderRowHeader: (row: Row) => <span>{row.kind === "group" ? row.label : row.id}</span>,
    onOpenThread: vi.fn(),
    onDecide: vi.fn(async () => {}),
    onToggleRow: vi.fn(),
    loadDetail: vi.fn(async (block: LaneBlock) => fixtureDetail(block)),
    describeThread: describeFixture(fixture.threads),
    ...overrides,
  };
  const view = render(<LanesTimeline {...props} />);
  return { props, view };
}

const block = (name: RegExp) => screen.getByRole("button", { name });

describe("LanesTimeline", () => {
  it("draws each lane as a labelled list of turn buttons", () => {
    setup();
    expect(screen.getByRole("list", { name: "Coordinate the Lanes build's turns" })).toBeTruthy();
    const merge = block(/^Coordinate the Lanes build: Merge the backend and brief the shell – Done, took 3m/);
    expect(merge.getAttribute("aria-haspopup")).toBe("dialog");
    expect(block(/^Rotate API keys: Rotate the API keys – Needs you, 14m so far/)).toBeTruthy();
  });

  it("culls turns far outside the window", () => {
    setup();
    // "Plan the Lanes build" ended 33 minutes ago: beyond the 15m window and its margin.
    expect(screen.queryByRole("button", { name: /Plan the Lanes build/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Write the spec and contracts/ })).not.toBeNull();
  });

  it("announces who needs you", () => {
    setup();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("2 need you");
  });

  it("opens the tooltip with a skeleton, then the summary, and caches it", async () => {
    const { props } = setup();
    const merge = block(/Merge the backend and brief the shell/);
    fireEvent.click(merge);
    const tip = screen.getByRole("dialog", { name: /Merge the backend/ });
    expect(tip.querySelector(".bl-tip-skeleton")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("Ran the full test suite: 132 passed")).toBeTruthy());
    expect(merge.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(merge);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(merge);
    expect(screen.getByText("Ran the full test suite: 132 passed")).toBeTruthy();
    expect(props.loadDetail).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and gives focus back to the block", () => {
    setup();
    const merge = block(/Merge the backend and brief the shell/);
    merge.focus();
    fireEvent.click(merge);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(merge);
  });

  it("closes when the pointer goes down elsewhere", () => {
    setup();
    fireEvent.click(block(/Merge the backend and brief the shell/));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens threads beside Lanes, or here with ⇧↵ and ⌘-click", () => {
    const { props } = setup();
    const merge = block(/Merge the backend and brief the shell/);
    merge.focus();
    fireEvent.keyDown(merge, { key: "Enter" });
    fireEvent.keyDown(merge, { key: "Enter" });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", { split: true });
    fireEvent.click(merge);
    fireEvent.keyDown(merge, { key: "Enter", shiftKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", { split: false });
    fireEvent.click(block(/Customer interviews/), { metaKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_research", { split: false });
  });

  it("decides inline: Approve has focus and answers the waiting turn", async () => {
    const { props } = setup();
    fireEvent.click(block(/Rotate the API keys/));
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(document.activeElement).toBe(approve);
    await act(async () => fireEvent.click(approve));
    expect(props.onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: "k2" }), "approve");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(block(/Rotate the API keys/));
  });

  it("moves focus through a lane and between lanes with the arrow keys", () => {
    setup();
    const shell = block(/Group lanes like the sidebar/);
    shell.focus();
    fireEvent.keyDown(shell, { key: "ArrowRight" });
    expect(document.activeElement).toBe(block(/Push the shell to main/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Timeline engine: Build the timeline engine/);
    expect(document.activeElement?.getAttribute("tabindex")).toBe("0");
  });

  it("tabs block to block and keeps a single tab stop", () => {
    setup();
    const stops = () => document.querySelectorAll('.bl-item[tabindex="0"]');
    expect(stops()).toHaveLength(1);
    const first = stops()[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "Tab" });
    expect(document.activeElement).not.toBe(first);
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toBe(document.activeElement);
  });

  it("offers a wider window when there is nothing to show", () => {
    const onViewportChange = vi.fn();
    setup({ rows: [], onViewportChange });
    expect(screen.getByText("No agent activity in the last 15m")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the last 1h" }));
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ span: 60 * MINUTE, live: true }));
  });

  it("lets the shell replace the empty state", () => {
    setup({ rows: [], emptyState: <p>Nothing matches “deploy”</p> });
    expect(screen.getByText("Nothing matches “deploy”")).toBeTruthy();
  });
});
