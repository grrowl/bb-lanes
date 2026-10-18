// Open a thread scrolled to one turn instead of its latest message.
//
// bb's own message search does this by navigating to the thread with router
// state `{ searchMessageSeq, searchThreadId }`: the thread view scrolls to the
// row holding that event sequence, loading older rows if it must, and flashes
// it. The plugin SDK's `open()` has no option for that state yet, so once the
// thread's route is showing we re-announce the same URL with it. React Router
// reads `history.state.usr` as the location state, and a popstate makes it
// take the new entry. If bb ever changes this, the thread simply opens at its
// latest message, as it did before.

const SETTLE_MS = 600;

export function revealTurn(threadId: string, seq: number): void {
  const deadline = performance.now() + SETTLE_MS;
  const attempt = () => {
    if (!window.location.pathname.endsWith(`/threads/${threadId}`)) {
      if (performance.now() < deadline) requestAnimationFrame(attempt);
      return;
    }
    const previous = (window.history.state ?? {}) as { usr?: unknown };
    const usr = typeof previous.usr === "object" && previous.usr !== null ? previous.usr : {};
    const state = {
      ...previous,
      usr: { ...usr, searchMessageSeq: seq, searchThreadId: threadId },
      // A fresh key makes the router treat this as a new location to act on.
      key: `lanes-${Date.now().toString(36)}`,
    };
    window.history.replaceState(state, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  };
  requestAnimationFrame(attempt);
}
