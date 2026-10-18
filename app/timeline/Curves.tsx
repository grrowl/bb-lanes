// Hand-off lines live in the moving layer, so they slide with the blocks they
// join. The SVG is the reference's: x in tenths of a percent of the track
// (0–1000, stretched with preserveAspectRatio="none") and y in px, strokes
// kept crisp with vector-effect. Caps are HTML on top, so a dot stays round
// and an arrow stays sharp however the SVG is stretched.
import { memo } from "react";
import { HANDOFF_LINES, type LineCap } from "../../shared/view";
import type { Curve, RowLayout } from "./layout";
import { edgeLandingPath, handoffPath } from "./layout";
import { layerPercent } from "./time";

const STUB_PX = 44;

export interface CurvesProps {
  curves: readonly Curve[];
  layout: RowLayout;
  anchor: number;
  span: number;
  width: number;
  uid: string;
}

export const Curves = memo(function Curves({ curves, layout, anchor, span, width, uid }: CurvesProps) {
  const unitsPerPx = 1000 / Math.max(1, width);
  const x = (t: number) => layerPercent(t, anchor, span) * 10;
  const yOf = (row: number) => layout.mids[row]!;
  const paths = curves.map((curve) => {
    const style = HANDOFF_LINES[curve.handoff.kind];
    const color = style.color;
    if (curve.from.row !== null && curve.to.row !== null) {
      const y1 = yOf(curve.from.row);
      const d = curve.to.midTurn
        ? edgeLandingPath(x(curve.from.t), y1, x(curve.to.t), landingY(layout, curve.to.row, y1))
        : handoffPath(x(curve.from.t), y1, x(curve.to.t), yOf(curve.to.row));
      return { curve, style, color, d, stub: null };
    }
    // One end is not shown: a short tail that fades towards the missing lane.
    const out = curve.to.row === null;
    const t = out ? curve.from.t : curve.to.t;
    const y = yOf((out ? curve.from.row : curve.to.row)!);
    const x0 = out ? x(t) : x(t) - STUB_PX * unitsPerPx;
    const x3 = x0 + STUB_PX * unitsPerPx;
    const d = out
      ? `M ${x0} ${y} C ${x0 + 20 * unitsPerPx} ${y}, ${x0 + 26 * unitsPerPx} ${y + 10}, ${x3} ${y + 12}`
      : `M ${x0} ${y - 12} C ${x3 - 26 * unitsPerPx} ${y - 10}, ${x3 - 20 * unitsPerPx} ${y}, ${x3} ${y}`;
    return { curve, style, color, d, stub: { x0, x3, y, out } };
  });
  return (
    <svg
      className="bl-curves"
      viewBox={`0 0 1000 ${Math.max(1, layout.total)}`}
      preserveAspectRatio="none"
      style={{ height: layout.total }}
      aria-hidden="true"
    >
      <defs>
        {paths.map(({ curve, color, stub }) =>
          stub ? (
            <linearGradient
              key={curve.handoff.id}
              id={stubGradientId(uid, curve.handoff.id)}
              data-color={color}
              gradientUnits="userSpaceOnUse"
              x1={stub.x0}
              x2={stub.x3}
              y1={stub.y}
              y2={stub.y}
            >
              <stop offset="0" stopColor="currentColor" stopOpacity={stub.out ? 1 : 0} />
              <stop offset="1" stopColor="currentColor" stopOpacity={stub.out ? 0 : 1} />
            </linearGradient>
          ) : null,
        )}
      </defs>
      {paths.map(({ curve, style, color, d, stub }) => (
        <g key={curve.handoff.id}>
          <path
            className="bl-curve"
            d={d}
            data-h={curve.handoff.id}
            data-kind={curve.handoff.kind}
            data-stroke={style.stroke}
            data-color={color}
            data-live={curve.live ? "" : undefined}
            data-stub={stub ? "" : undefined}
            style={stub ? { stroke: `url(#${stubGradientId(uid, curve.handoff.id)})` } : undefined}
            vectorEffect="non-scaling-stroke"
          />
          {!stub && <path className="bl-curve-hit" d={d} data-h={curve.handoff.id} vectorEffect="non-scaling-stroke" />}
        </g>
      ))}
    </svg>
  );
});

/** The caps at either end of each line, from HANDOFF_LINES: a dot, a ring, or an arrow into the target. */
export const CurveCaps = memo(function CurveCaps({ curves, layout, anchor, span }: Omit<CurvesProps, "width" | "uid">) {
  const yOf = (row: number) => layout.mids[row]!;
  return (
    <>
      {curves.map((curve) => {
        const style = HANDOFF_LINES[curve.handoff.kind];
        return (
          <span key={curve.handoff.id} className="bl-caps" data-h={curve.handoff.id} data-color={style.color}>
            {curve.from.row !== null && (
              <Cap kind={style.start} at="start" left={layerPercent(curve.from.t, anchor, span)} top={yOf(curve.from.row)} />
            )}
            {curve.to.row !== null && (
              <Cap
                kind={style.end}
                at="end"
                left={layerPercent(curve.to.t, anchor, span)}
                top={curve.to.midTurn && curve.from.row !== null ? landingY(layout, curve.to.row, yOf(curve.from.row)) : yOf(curve.to.row)}
                dir={curve.to.midTurn && curve.from.row !== null ? (curve.from.row < curve.to.row ? "down" : "up") : "right"}
              />
            )}
          </span>
        );
      })}
    </>
  );
});

function Cap({
  kind,
  at,
  left,
  top,
  dir = "right",
}: {
  kind: LineCap;
  at: "start" | "end";
  left: number;
  top: number;
  /** Which way an arrow points: along the lane, or down or up onto a block's edge. */
  dir?: "right" | "down" | "up";
}) {
  if (kind === "none") return null;
  return (
    <span className="bl-cap" data-cap={kind} data-at={at} data-dir={dir === "right" ? undefined : dir} style={{ left: `${left}%`, top }}>
      {kind === "arrow" && (
        <svg width="6" height="8" viewBox="0 0 6 8" aria-hidden="true">
          <path d="M1 1 L5 4 L1 7" />
        </svg>
      )}
    </span>
  );
}

/** The edge of the target's block that faces the sender's lane. */
function landingY(layout: RowLayout, row: number, fromY: number): number {
  const mid = layout.mids[row]!;
  return fromY < mid ? mid - layout.blockHalf : mid + layout.blockHalf;
}

function stubGradientId(uid: string, handoffId: string): string {
  return `${uid}-stub-${handoffId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
