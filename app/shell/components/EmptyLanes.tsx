// The card's calm placeholders, in the timeline's own empty look: shimmering
// ghost lanes while loading, and a designed empty state that says why nothing
// shows and offers the way out.
import { EmptyCard, LoadingGhosts } from "../../timeline/EmptyState";
import type { LaneFilter } from "../grouping/types";
import { formatDuration, widerPreset } from "../time";

export function LoadingLanes() {
  return <LoadingGhosts />;
}

export function EmptyLanes({
  span,
  filter,
  query,
  hasThreads,
  onWiden,
  onShowAll,
  onClearSearch,
}: {
  span: number;
  filter: LaneFilter;
  query: string;
  hasThreads: boolean;
  onWiden(span: number): void;
  onShowAll(): void;
  onClearSearch(): void;
}) {
  const wider = widerPreset(span);
  if (query.trim() !== "") {
    return (
      <EmptyCard
        title={`No lanes match “${query.trim()}”`}
        body="Search looks at titles, projects, models, and branches."
        action={{ label: "Clear search", run: onClearSearch }}
      />
    );
  }
  if (!hasThreads) {
    return <EmptyCard title="No threads yet" body="Start a thread and its turns will show up here as they happen." />;
  }
  if (filter === "needs-you") {
    return (
      <EmptyCard
        title="Nobody needs you"
        body="Approvals and questions from agents will show up here."
        action={{ label: "Show all lanes", run: onShowAll }}
      />
    );
  }
  if (filter === "failed") {
    return (
      <EmptyCard
        title="Nothing failed"
        body="Turns that end in an error will show up here."
        action={{ label: "Show all lanes", run: onShowAll }}
      />
    );
  }
  return (
    <EmptyCard
      title={`No agent activity in the last ${formatDuration(span)}`}
      body="Lanes appear when an agent starts a turn."
      action={
        wider !== null
          ? { label: `Show last ${wider.label}`, run: () => onWiden(wider.ms) }
          : { label: "Show all lanes", run: onShowAll }
      }
    />
  );
}
