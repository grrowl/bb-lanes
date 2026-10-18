// Shown when there are no lanes to draw: a calm card over a faint picture of
// what will appear, drawn with the same block primitives as the real thing.
// The shell reuses the card with its own words (filters, search), and the
// ghosts alone, shimmering, while the first data loads.
import { DAY, HOUR, MINUTE, formatSpan } from "./time";

const SPANS = [15 * MINUTE, HOUR, 4 * HOUR, DAY, 7 * DAY];

/** The next preset window wider than `span`, or null at the widest. */
export function widerSpan(span: number): number | null {
  return SPANS.find((s) => s > span * 1.01) ?? null;
}

// Ghost lanes: [left %, width %, state] per block. Two hand-offs run from a
// block's end to the next lane's block, as upstream's curve does.
type Ghost = [left: number, width: number, state?: "running" | "waiting"];
const GHOSTS: Ghost[][] = [
  [
    [6, 22],
    [36, 14],
    [62, 38, "running"],
  ],
  [
    [30, 24],
    [60, 12],
    [76, 16],
  ],
  [
    [2, 12],
    [40, 34],
    [84, 16, "waiting"],
  ],
  [
    [18, 16],
    [76, 14],
  ],
];

function GhostLanes() {
  return (
    <div className="bl-empty-ghosts" aria-hidden="true">
      <svg className="bl-empty-curve" viewBox="0 0 100 192" preserveAspectRatio="none">
        <path d="M 28 24 C 30.4 24, 27.6 72, 30 72" vectorEffect="non-scaling-stroke" />
        <path d="M 74 120 C 76.4 120, 73.6 168, 76 168" vectorEffect="non-scaling-stroke" />
      </svg>
      {GHOSTS.map((lane, row) => (
        <div key={row} className="bl-empty-lane">
          <span className="bl-empty-name">
            <span className="bl-empty-avatar" />
            <span className="bl-empty-text" style={{ width: `${54 + ((row * 23) % 40)}%` }} />
          </span>
          <span className="bl-empty-track">
            {lane.map(([left, width, state], i) => (
              <span
                key={i}
                className="bl-empty-block"
                data-state={state}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface EmptyCardProps {
  title: string;
  body: string;
  action?: { label: string; run(): void } | null;
}

/** The empty card: what is missing, why, and the one way out. */
export function EmptyCard({ title, body, action = null }: EmptyCardProps) {
  return (
    <div className="bl-empty">
      <GhostLanes />
      <div className="bl-empty-copy" role="status">
        <p className="bl-empty-title">{title}</p>
        <p className="bl-empty-text-line">{body}</p>
        {action !== null && (
          <button type="button" className="bl-btn" onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** The ghosts alone, shimmering, while the first lanes load. */
export function LoadingGhosts({ label = "Loading lanes" }: { label?: string }) {
  return (
    <div className="bl-empty" data-loading="" role="status" aria-label={label}>
      <GhostLanes />
    </div>
  );
}

export function EmptyState({ span, onWiden }: { span: number; onWiden: ((span: number) => void) | null }) {
  const wider = widerSpan(span);
  return (
    <EmptyCard
      title={`No agent activity in the ${formatSpan(span).toLowerCase()}`}
      body="Turns appear here as they start, one lane per thread."
      action={wider !== null && onWiden ? { label: `Show ${formatSpan(wider).toLowerCase()}`, run: () => onWiden(wider) } : null}
    />
  );
}
