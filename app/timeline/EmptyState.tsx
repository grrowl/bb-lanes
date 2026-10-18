// Shown when there are no lanes to draw: a calm card over a faint picture of
// what will appear, drawn with the same block primitives as the real thing.
import { DAY, HOUR, MINUTE, formatSpan } from "./time";

const SPANS = [15 * MINUTE, HOUR, 4 * HOUR, DAY, 7 * DAY];

/** The next preset window wider than `span`, or null at the widest. */
export function widerSpan(span: number): number | null {
  return SPANS.find((s) => s > span * 1.01) ?? null;
}

// Ghost lanes: [left %, width %] per block, and one hand-off between rows.
const GHOSTS: [number, number][][] = [
  [
    [6, 22],
    [33, 14],
    [62, 38],
  ],
  [
    [18, 30],
    [54, 12],
    [71, 18],
  ],
  [
    [2, 12],
    [40, 34],
    [80, 20],
  ],
  [
    [26, 16],
    [48, 9],
  ],
];

export function EmptyState({ span, onWiden }: { span: number; onWiden: ((span: number) => void) | null }) {
  const wider = widerSpan(span);
  return (
    <div className="bl-empty">
      <div className="bl-empty-ghosts" aria-hidden="true">
        <svg className="bl-empty-curve" viewBox="0 0 100 192" preserveAspectRatio="none">
          <path d="M 28 24 C 34 24, 12 72, 18 72" vectorEffect="non-scaling-stroke" />
          <path d="M 47 120 C 53 120, 21 168, 26 168" vectorEffect="non-scaling-stroke" />
        </svg>
        {GHOSTS.map((lane, row) => (
          <div key={row} className="bl-empty-lane">
            <span className="bl-empty-name">
              <span className="bl-empty-avatar" />
              <span className="bl-empty-text" style={{ width: `${54 + ((row * 23) % 40)}%` }} />
            </span>
            <span className="bl-empty-track">
              {lane.map(([left, width], i) => (
                <span key={i} className="bl-empty-block" style={{ left: `${left}%`, width: `${width}%` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="bl-empty-copy">
        <p className="bl-empty-title">No agent activity in the {formatSpan(span).toLowerCase()}</p>
        <p className="bl-empty-text-line">Turns appear here as they start, one lane per thread.</p>
        {wider !== null && onWiden && (
          <button type="button" className="bl-btn" onClick={() => onWiden(wider)}>
            Show the {formatSpan(wider).toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}
