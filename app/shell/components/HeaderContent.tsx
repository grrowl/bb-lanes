// What bb draws beside "Lanes" in the shared title bar: upstream's summary of
// what is going on. It is the one place the pane counts running and waiting
// threads; each count shows the lanes it counts. The window and its controls
// live on the tray's bar below.
import { useLiveCounts, type LiveCounts } from "../data/live-counts";
import { useSurface } from "../surface-store";
import type { LaneFilter } from "../grouping/types";

/** "3 running · 1 need you", the parts that matter, as upstream's bar says it. */
export function LiveSummary({ counts, onFilter }: { counts: LiveCounts; onFilter?(filter: LaneFilter): void }) {
  const parts = [
    { kind: "running", text: `${counts.running} running`, filter: "active" as const, title: "Show active lanes" },
    counts.waiting > 0 ? { kind: "needs", text: `${counts.waiting} need you`, filter: "needs-you" as const, title: "Show lanes that need you" } : null,
  ].filter((part) => part !== null);
  return (
    <span className="lanes-summary">
      {parts.map((part) =>
        onFilter ? (
          <button key={part.kind} type="button" data-kind={part.kind} title={part.title} onClick={() => onFilter(part.filter)}>
            {part.text}
          </button>
        ) : (
          <span key={part.kind} data-kind={part.kind}>
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

export function LanesHeaderContent() {
  const [, actions] = useSurface("lanes");
  const counts = useLiveCounts();
  return (
    <div className="bl-theme lanes-chrome">
      <LiveSummary counts={counts} onFilter={actions.setFilter} />
    </div>
  );
}

/** The sidebar row's trailing count: running, plus an amber count when someone is needed. */
export function LanesSidebarAccessory() {
  const counts = useLiveCounts();
  if (counts.running === 0 && counts.waiting === 0) return null;
  const label = [
    counts.running > 0 ? `${counts.running} running` : null,
    counts.waiting > 0 ? `${counts.waiting} need you` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span className="bl-theme lanes-chrome lanes-accessory" aria-label={label} title={label}>
      {counts.running > 0 ? <span>{counts.running}</span> : null}
      {counts.waiting > 0 ? <span data-kind="needs">{counts.waiting}</span> : null}
    </span>
  );
}
