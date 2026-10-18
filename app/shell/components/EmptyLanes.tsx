// Calm placeholders for the card: a faint ghost of lanes while loading, and a
// designed empty state that says why nothing shows and offers the way out.
import { Button } from "@/components/ui/button";
import type { LaneFilter } from "../grouping/types";
import { formatDuration, widerPreset } from "../time";

/** Faint lanes drawn with block shapes; tones hint at what lanes look like alive. */
const GHOST_LANES: { left: number; width: number; tone?: "run" | "warn" }[][] = [
  [{ left: 8, width: 22 }, { left: 46, width: 30, tone: "run" }],
  [{ left: 18, width: 34 }, { left: 70, width: 18 }],
  [{ left: 4, width: 14 }, { left: 34, width: 16 }, { left: 62, width: 26, tone: "warn" }],
];

function GhostLanes({ shimmer = false }: { shimmer?: boolean }) {
  return (
    <div className={shimmer ? "animate-pulse motion-reduce:animate-none" : undefined} aria-hidden="true">
      {GHOST_LANES.map((lane, index) => (
        <div key={index} className="flex items-center gap-3 py-[13px]">
          <span className="lanes-avatar opacity-60" />
          <span className="h-2.5 w-24 flex-none rounded-full bg-muted opacity-70" />
          <div className="lanes-ghost-track flex-1">
            {lane.map((block, blockIndex) => (
              <span
                key={blockIndex}
                className="lanes-ghost-block"
                data-tone={shimmer ? undefined : block.tone}
                style={{ left: `${block.left}%`, width: `${block.width}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingLanes() {
  return (
    <div className="px-5 pt-3" role="status" aria-label="Loading lanes">
      <GhostLanes shimmer />
    </div>
  );
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
  let title: string;
  let body: string;
  let action: { label: string; run(): void } | null = null;
  if (query.trim() !== "") {
    title = `No lanes match “${query.trim()}”`;
    body = "Search looks at titles, projects, models, and branches.";
    action = { label: "Clear search", run: onClearSearch };
  } else if (!hasThreads) {
    title = "No threads yet";
    body = "Start a thread and its turns will show up here as they happen.";
  } else if (filter === "needs-you") {
    title = "Nobody needs you";
    body = "Approvals and questions from agents will show up here.";
    action = { label: "Show all lanes", run: onShowAll };
  } else if (filter === "failed") {
    title = "Nothing failed";
    body = "Turns that end in an error will show up here.";
    action = { label: "Show all lanes", run: onShowAll };
  } else {
    title = `No agent activity in the last ${formatDuration(span)}`;
    body = "Lanes appear when an agent starts a turn.";
    action = wider !== null ? { label: `Show last ${wider.label}`, run: () => onWiden(wider.ms) } : { label: "Show all lanes", run: onShowAll };
  }

  return (
    <div className="lanes-rise relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10">
      <div className="pointer-events-none absolute inset-x-6 top-6 opacity-50 [mask-image:linear-gradient(to_bottom,#000,transparent_85%)]">
        <GhostLanes />
      </div>
      <div className="relative flex max-w-sm flex-col items-center gap-1 text-center">
        <p className="text-[14px] font-semibold leading-5 text-foreground">{title}</p>
        <p className="text-[12px] leading-4 text-muted-foreground">{body}</p>
        {action !== null ? (
          <Button variant="outline" size="sm" className="mt-3 h-7 px-3 text-[12px]" onClick={action.run}>
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
