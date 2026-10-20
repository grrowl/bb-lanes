// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LaneBlock } from "../../shared/model";
import type { Row, TimelineProps } from "../../shared/view";
import { describeFixture, fixtureDetail, fixtureRows, scenario } from "./fixtures";
import { LanesTimeline } from "./LanesTimeline";
import { MINUTE } from "./time";
import { installLayoutShims } from "../../test/layout";

beforeAll(() => {
  installTestPluginRuntime();
  installLayoutShims();
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
  it("marks user turns, leaves spawned turns unmarked, and explains the origin", () => {
    setup();
    const user = block(/Customer interviews/);
    expect((user.closest(".bl-slot") as HTMLElement).dataset.origin).toBe("user");
    expect(user.getAttribute("aria-label")).toContain("started by you");
    const spawned = block(/Build the timeline engine/);
    expect(spawned.closest(".bl-slot")!.hasAttribute("data-origin")).toBe(false);
    fireEvent.click(user);
    expect(screen.getByText("Started by you")).toBeTruthy();
  });

  it("marks bb inputs, keeps uncertain inputs unmarked, and avoids duplicating an incoming hand-off", () => {
    const fixture = scenario(BASE, 2, { noHistory: true });
    const blocks = fixture.blocks.map((turn) => turn.id === "r2" ? { ...turn, initiator: "system" as const }
      : turn.id === "s2" ? { ...turn, initiatorConfirmed: false }
      : turn.id === "b2" ? { ...turn, initiator: "system" as const, senderThreadId: null } : turn);
    setup({ blocks });
    const bb = block(/Customer interviews/);
    expect((bb.closest(".bl-slot") as HTMLElement).dataset.origin).toBe("system");
    expect(bb.getAttribute("aria-label")).toContain("started by bb");
    expect(block(/Push the shell to main/).closest(".bl-slot")!.hasAttribute("data-origin")).toBe(false);
    expect(block(/Answer the coordinator's review notes/).closest(".bl-slot")!.hasAttribute("data-origin")).toBe(false);
    fireEvent.click(bb);
    expect(screen.getByText("Started by bb")).toBeTruthy();
  });

  it("names the tool group on keyboard focus without adding another tab stop", async () => {
    setup();
    const turn = block(/Merge the backend and brief the shell/);
    act(() => turn.focus());
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe("Commands · Delegation");
    expect(turn.getAttribute("aria-label")).toContain("Commands · Delegation");
    expect(turn.querySelector(".bl-tools")!.getAttribute("tabindex")).toBeNull();
    fireEvent.click(turn);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
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

  it("retries failed detail loads and exposes the fetched prompt and recent tools", async () => {
    const loadDetail = vi.fn(async (turn: LaneBlock) => ({
      ...fixtureDetail(turn), prompt: "Check the actual timeline and summarize the result", recent: [{ kind: "command" as const, label: "npm test" }],
    })).mockRejectedValueOnce(new Error("Disconnected"));
    setup({ loadDetail });
    const merge = block(/Merge the backend and brief the shell/);
    fireEvent.click(merge);
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(document.activeElement).toBe(merge);
    await screen.findByText("Ran the full test suite: 132 passed");
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Turn details")).toBeTruthy();
    expect(screen.getByText("Check the actual timeline and summarize the result")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    fireEvent.keyDown(merge, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(merge);
  });

  it("ignores an older request's error after the tooltip has reopened and loaded successfully", async () => {
    let rejectFirst!: (error: Error) => void;
    const loadDetail = vi.fn(async (turn: LaneBlock) => fixtureDetail(turn))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    setup({ loadDetail });
    const merge = block(/Merge the backend and brief the shell/);
    fireEvent.click(merge);
    fireEvent.pointerDown(document.body);
    fireEvent.click(merge);
    await screen.findByText("Ran the full test suite: 132 passed");
    await act(async () => rejectFirst(new Error("Old request failed")));
    expect(screen.getByText("Ran the full test suite: 132 passed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("cleans Markdown emphasis and link syntax from summary text while preserving code", async () => {
    setup({ loadDetail: async (turn) => ({ ...fixtureDetail(turn), summary: ["**Checked** [the build](https://example.com/build) with `**options`."] }) });
    fireEvent.click(block(/Merge the backend and brief the shell/));
    await waitFor(() => expect(document.querySelector(".bl-tip-list")?.textContent).toBe("Checked the build with **options."));
    expect(document.querySelector(".bl-tip-code")?.textContent).toBe("**options");
  });

  it("closes when the pointer goes down elsewhere", () => {
    setup();
    fireEvent.click(block(/Merge the backend and brief the shell/));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([true, false])("opens every thread action with openBeside=%s and reverses it with ⌘/Ctrl", (openBeside) => {
    const { props } = setup({ openBeside });
    const merge = block(/Merge the backend and brief the shell/);
    merge.focus();
    fireEvent.keyDown(merge, { key: "Enter" });
    fireEvent.keyDown(merge, { key: "Enter" });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: openBeside }));
    fireEvent.click(merge);
    fireEvent.keyDown(merge, { key: "Enter", metaKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: !openBeside }));
    fireEvent.click(block(/Customer interviews/), { metaKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_research", expect.objectContaining({ split: !openBeside }));
    fireEvent.click(merge, { detail: 2 });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: openBeside }));

    fireEvent.click(merge);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: openBeside }));
    fireEvent.click(merge);
    fireEvent.keyDown(screen.getByRole("button", { name: "Open" }), { key: "Enter", ctrlKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: !openBeside }));
    fireEvent.click(merge);
    fireEvent.click(screen.getByRole("button", { name: openBeside ? /^Open here/ : /^Open to the side/ }));
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_coord", expect.objectContaining({ split: !openBeside }));

    fireEvent.click(block(/Rotate the API keys/));
    fireEvent.click(screen.getByRole("button", { name: "Open" }), { ctrlKey: true });
    expect(props.onOpenThread).toHaveBeenLastCalledWith("thr_keys", expect.objectContaining({ split: !openBeside }));
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
    fireEvent.click(screen.getByRole("button", { name: "Show last 1h" }));
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ span: 60 * MINUTE, live: true }));
  });

  it("lets the shell replace the empty state", () => {
    setup({ rows: [], emptyState: <p>Nothing matches “deploy”</p> });
    expect(screen.getByText("Nothing matches “deploy”")).toBeTruthy();
  });
});
