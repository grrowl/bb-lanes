// DEV ONLY. A crude implementation of `TimelineProps` so the shell can be
// built and tested before the real engine (app/timeline/LanesTimeline)
// lands: header cells, coloured divs per block, and a "now" edge. Not
// registered anywhere once the engine is wired in app.tsx.
import { useState } from "react";
import type { LaneBlock } from "../../../shared/model";
import type { Row, TimelineProps } from "../../../shared/view";

const TONE: Record<LaneBlock["status"], string> = {
  done: "bg-muted",
  running: "bg-[var(--lanes-run-wash)]",
  waiting: "bg-[var(--lanes-warn-wash)]",
  failed: "bg-[var(--lanes-danger-wash)]",
  interrupted: "bg-muted",
};

export function StandInTimeline(props: TimelineProps) {
  const { rows, blocks, now, viewport, density, renderRowHeader, onOpenThread, onToggleRow, namesWidth = 168 } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const height = density === "compact" ? 36 : 48;
  const start = viewport.end - viewport.span;
  const left = (time: number) => ((time - start) / viewport.span) * 100;
  const byThread = new Map<string, LaneBlock[]>();
  for (const block of blocks) {
    const list = byThread.get(block.threadId);
    if (list === undefined) byThread.set(block.threadId, [block]);
    else list.push(block);
  }
  const blocksFor = (row: Row): LaneBlock[] =>
    row.kind === "lane"
      ? (byThread.get(row.id) ?? [])
      : row.collapsed
        ? row.threadIds.flatMap((id) => byThread.get(id) ?? [])
        : [];

  if (rows.length === 0) return <>{props.emptyState}</>;
  return (
    <div className={`${props.className ?? ""} min-h-0 overflow-auto`} data-testid="stand-in-timeline">
      {rows.map((row) => (
        <div
          key={`${row.kind}:${row.id}`}
          className="grid border-b border-border/50"
          style={{ gridTemplateColumns: `${namesWidth}px minmax(0, 1fr)`, height }}
          onPointerEnter={() => setHovered(row.id)}
          onPointerLeave={() => setHovered(null)}
        >
          <div className="min-w-0">{renderRowHeader(row, { hovered: hovered === row.id, focused: false })}</div>
          <div className="relative overflow-hidden" onClick={() => row.kind === "group" && onToggleRow(row)}>
            {blocksFor(row)
              .filter((block) => (block.end ?? now) >= start)
              .map((block) => {
                const from = Math.max(0, left(block.start));
                const to = Math.min(100, left(block.end ?? now));
                return (
                  <button
                    key={block.id}
                    type="button"
                    aria-label={`${block.title || "Turn"} – ${block.status}`}
                    className={`absolute top-2.5 bottom-2.5 min-w-1.5 truncate rounded-lg px-2 text-left text-[12px] ${TONE[block.status]}`}
                    style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }}
                    onClick={(event) => onOpenThread(block.threadId, { split: event.metaKey || event.ctrlKey })}
                  >
                    {block.title}
                  </button>
                );
              })}
            <span className="absolute inset-y-0 right-0 w-px bg-[var(--lanes-run)]" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  );
}
