// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { revealTurn } from "./revealTurn";

describe("revealTurn", () => {
  it("re-announces the open thread with bb's search-jump state", async () => {
    window.history.replaceState({ usr: { from: "lanes" }, key: "a", idx: 3 }, "", "/projects/p/threads/thr_x");
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    revealTurn("thr_x", 980);
    await vi.waitFor(() => expect(popped).toHaveBeenCalledTimes(1));
    expect(window.history.state).toMatchObject({
      idx: 3,
      usr: { from: "lanes", searchMessageSeq: 980, searchThreadId: "thr_x" },
    });
    expect(window.history.state.key).not.toBe("a");
    window.removeEventListener("popstate", popped);
  });

  it("does nothing when the thread never shows", async () => {
    window.history.replaceState({ key: "b" }, "", "/plugins/lanes/lanes");
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    revealTurn("thr_y", 12);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(popped).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ key: "b" });
    window.removeEventListener("popstate", popped);
  });
});
