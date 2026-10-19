// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LANES_CHANGED, type LanesSnapshot } from "../../shared/model";
import type { rpcContract } from "../../shared/rpc";
import { installLayoutShims } from "../../test/layout";
import { makeBlock, makeProject, makeThread } from "./testing/fixtures";

beforeAll(installLayoutShims);

const NOW = Date.now();

const threads = [
  makeThread({ id: "lead", title: "Plan the release", runtimeStatus: "active", status: "active", latestAttentionAt: NOW }),
  makeThread({ id: "worker", title: "Write the migration", parentThreadId: "lead", runtimeStatus: "active", status: "active" }),
  makeThread({ id: "asks", title: "Deploy to staging", hasPendingInteraction: true, runtimeStatus: "active", status: "active" }),
  makeThread({ id: "done", title: "Tidy the docs", projectId: "proj_b", latestAttentionAt: NOW - 60_000 }),
  makeThread({ id: "ancient", title: "Old experiment", projectId: "proj_b", latestAttentionAt: 1 }),
];

const sidebarThreads = {
  status: "ready" as const,
  threads,
  projects: [makeProject({ id: "proj_a", name: "bb-lanes" }), makeProject({ id: "proj_b", name: "chillidonut" })],
  sections: [],
};

function snapshot(blocks = [
  makeBlock({ id: "t-lead", threadId: "lead", start: NOW - 5 * 60_000, title: "Spec the pane" }),
  makeBlock({ id: "t-done", threadId: "done", start: NOW - 10 * 60_000, end: NOW - 8 * 60_000, status: "done", title: "Fix typos" }),
]): LanesSnapshot {
  return { generatedAt: Date.now(), since: NOW - 3_600_000, blocks, handoffs: [], indexing: false };
}

async function loadApp() {
  return loadPluginApp(() => import("../../app"));
}

function rpc(windowSnapshot = snapshot()) {
  return {
    lanes_window: () => windowSnapshot,
    lanes_neighbors: () => ({ neighbors: {} }),
    lanes_block_detail: ({ threadId, blockId }: { threadId: string; blockId: string }) => ({
      blockId,
      threadId,
      summary: [],
      prompt: "",
      recent: [],
    }),
    lanes_decide: () => ({ ok: true, message: null }),
  };
}

describe("Lanes app registration", () => {
  it("registers the Lanes pane, its header, accessory, and the team panel action", async () => {
    const app = await loadApp();
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({ id: "lanes", path: "lanes", title: "Lanes", icon: "agent-lanes/lanes" });
    expect(app.navPanels[0]?.headerContent).toBeTypeOf("function");
    expect(app.navPanels[0]?.experimental_sidebarAccessory).toBeTypeOf("function");
    expect(app.threadPanelActions[0]).toMatchObject({ id: "team-lanes", title: "Team lanes", layout: "flush" });
  });
});

describe("Lanes nav panel", () => {
  it("keeps viewport shortcuts working after closing help, without stealing typing or another pane's keys", async () => {
    const rects = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const matchMedia = window.matchMedia;
    const motion = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...matchMedia(query), matches: query === "(prefers-reduced-motion: reduce)",
    }));
    const app = await loadApp();
    const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-shortcuts", sidebarThreads, rpc: rpc(),
    });
    try {
      await slot.findByText("Spec the pane");
      const help = screen.getByRole("button", { name: "Keyboard shortcuts" });
      fireEvent.click(help);
      const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
      expect(within(dialog).queryAllByRole("menuitem")).toHaveLength(0);
      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(help));
      fireEvent.keyDown(help, { key: "2" });
      expect(screen.getByRole("button", { name: "Window: Last 1h" })).toBeTruthy();
      await waitFor(() => expect(screen.getByRole("region", { name: "Agent lanes" }).hasAttribute("data-moving")).toBe(false));
      fireEvent.keyDown(help, { key: "=" });
      await screen.findByRole("button", { name: "Window: Last 30m" });
      fireEvent.keyDown(help, { key: "-" });
      await screen.findByRole("button", { name: "Window: Last 1h" });
      fireEvent.keyDown(help, { key: "[" });
      await screen.findByRole("button", { name: /Window: .*not following the clock/ });
      fireEvent.keyDown(help, { key: "n" });
      await screen.findByRole("button", { name: "Window: Last 1h" });

      fireEvent.keyDown(help, { key: "/" });
      const search = screen.getByRole("searchbox");
      expect(document.activeElement).toBe(search);
      for (const key of ["1", "[", "-", "n", "g"]) fireEvent.keyDown(search, { key });
      expect(screen.getByRole("button", { name: "Window: Last 1h" })).toBeTruthy();
      expect(screen.queryByRole("menu")).toBeNull();

      const outside = document.createElement("button");
      document.body.append(outside);
      outside.focus();
      for (const key of ["1", "[", "-", "n", "/", "g"]) fireEvent.keyDown(outside, { key });
      expect(screen.getByRole("button", { name: "Window: Last 1h" })).toBeTruthy();
      expect(document.activeElement).toBe(outside);
      outside.remove();

      act(() => help.focus());
      fireEvent.keyDown(help, { key: "1", ctrlKey: true });
      fireEvent.keyDown(help, { key: "1", isComposing: true });
      expect(screen.getByRole("button", { name: "Window: Last 1h" })).toBeTruthy();
      fireEvent.keyDown(help, { key: "G" });
      await screen.findByRole("menu");
    } finally {
      slot.lifecycle.unmount();
      rects.mockRestore();
      motion.mockRestore();
    }
  });

  it("renders grouped lanes from sidebar threads and the lanes_window snapshot", async () => {
    const app = await loadApp();
    const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-render",
      sidebarThreads,
      rpc: rpc(),
    });
    await slot.findByText("Spec the pane");
    // Active is the default: the ancient idle lane with no turn in the window is hidden.
    expect(screen.getByText("bb-lanes")).toBeTruthy();
    expect(screen.getByText("chillidonut")).toBeTruthy();
    expect(screen.queryByText("Old experiment")).toBeNull();
    expect(screen.getByText("Write the migration")).toBeTruthy();
    // Group headers summarise in upstream's words, hiding parts that are zero.
    const group = screen.getByRole("button", { name: /^bb-lanes,/ });
    expect(group.getAttribute("aria-label")).toBe("bb-lanes, 2 running, 1 need you, 3 lanes");
    expect(within(group).getByText("1 need you")).toBeTruthy();
    expect(within(group).queryByText(/failed/)).toBeNull();
    expect(screen.getByRole("button", { name: /^chillidonut,/ }).getAttribute("aria-label")).toBe("chillidonut, 1 lane");
    expect(screen.getAllByText("Needs you").length).toBeGreaterThan(0);
    expect(slot.inspection.rpcCalls[0]).toMatchObject({ method: "lanes_window" });
    slot.lifecycle.unmount();
  });

  it("merges realtime signals and refetches on an empty one and on reconnect", async () => {
    const app = await loadApp();
    const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-realtime",
      sidebarThreads,
      rpc: rpc(),
    });
    await slot.findByText("Spec the pane");
    await slot.behavior.emitRealtime(LANES_CHANGED, {
      blocks: [makeBlock({ id: "t-worker", threadId: "worker", start: NOW - 60_000, title: "Draft the index" })],
      handoffs: [],
      generatedAt: Date.now(),
    });
    await slot.findByText("Draft the index");

    const windowCalls = () => slot.inspection.rpcCalls.filter((call) => call.method === "lanes_window").length;
    const before = windowCalls();
    await slot.behavior.emitRealtime(LANES_CHANGED, { blocks: [], handoffs: [], generatedAt: Date.now() });
    await waitFor(() => expect(windowCalls()).toBe(before + 1));

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(windowCalls()).toBe(before + 2));
    slot.lifecycle.unmount();
  });

  it("filters, searches, and opens threads from the lane header", async () => {
    const app = await loadApp();
    const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-filter",
      sidebarThreads,
      rpc: rpc(),
    });
    await slot.findByText("Spec the pane");

    fireEvent.click(screen.getByRole("radio", { name: /Needs you/ }));
    await waitFor(() => expect(screen.queryByText("Write the migration")).toBeNull());
    expect(screen.getByText("Deploy to staging")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    await slot.findByText("Old experiment");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "docs" } });
    await waitFor(() => expect(screen.queryByText("Deploy to staging")).toBeNull());
    const docs = screen.getByRole("link", { name: /Tidy the docs/ });
    // A plain click opens beside Lanes; ⌘-click opens in place.
    fireEvent.click(docs);
    fireEvent.click(docs, { metaKey: true });
    expect(slot.inspection.sidebarActionCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "open", threadId: "done", options: { split: true } }),
      expect.objectContaining({ method: "open", threadId: "done", options: { split: false } }),
    ]));
    slot.lifecycle.unmount();
  });

  it("shows the reason and a way out when nothing is in the window", async () => {
    const app = await loadApp();
    const quiet = { ...sidebarThreads, threads: [makeThread({ id: "idle", title: "Sleeping" })] };
    const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-empty",
      sidebarThreads: quiet,
      rpc: rpc(snapshot([])),
    });
    await slot.findByText("No agent activity in the last 15m");
    fireEvent.click(screen.getByRole("button", { name: "Show last 1h" }));
    await slot.findByText("No agent activity in the last 1h");
    slot.lifecycle.unmount();
  });
});

describe("Lanes chrome", () => {
  it("summarises live work in the title bar, once, and leaves the window to the body", async () => {
    const app = await loadApp();
    const header = renderSlot({ component: app.navPanels[0]!.headerContent! }, { subPath: "" }, {
      pluginId: "lanes-test-header",
      sidebarThreads,
    });
    expect(header.getByRole("button", { name: "2 running" })).toBeTruthy();
    expect(header.getByRole("button", { name: "1 need you" })).toBeTruthy();
    expect(header.queryByRole("button", { name: /^Window:/ })).toBeNull();
    header.lifecycle.unmount();

    const body = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: "" }, {
      pluginId: "lanes-test-header",
      sidebarThreads,
      rpc: rpc(),
    });
    await body.findByText("Spec the pane");
    expect(body.getByRole("button", { name: "Window: Last 15m" })).toBeTruthy();
    expect(body.container.querySelector(".lanes-bar .lanes-summary")).toBeNull();
    body.lifecycle.unmount();
  });

  it("shows a tiny live count on the sidebar row", async () => {
    const app = await loadApp();
    const accessory = renderSlot({ component: app.navPanels[0]!.experimental_sidebarAccessory! }, {}, {
      pluginId: "lanes-test-accessory",
      sidebarThreads,
    });
    expect(accessory.getByLabelText("2 running, 1 need you")).toBeTruthy();
    accessory.lifecycle.unmount();
  });

  it("scopes the team panel to the thread's tree", async () => {
    const app = await loadApp();
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "worker", params: null },
      { pluginId: "lanes-test-team", sidebarThreads, rpc: rpc() },
    );
    await panel.findByText("Write the migration");
    expect(panel.getByText("Plan the release")).toBeTruthy();
    expect(panel.queryByText("Deploy to staging")).toBeNull();
    const call = panel.inspection.rpcCalls.find((entry) => entry.method === "lanes_window");
    expect((call?.input as { threadIds?: string[] }).threadIds).toContain("worker");
    // Beside a thread there is no title bar, so the bar leads with the team's own summary.
    expect(within(panel.container).getByRole("button", { name: "Window: Last 15m" })).toBeTruthy();
    expect(panel.container.querySelector(".lanes-bar .lanes-summary")?.textContent).toBe("2 running");
    panel.lifecycle.unmount();
  });
});
