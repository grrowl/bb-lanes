// Hand-off lines live in the moving layer, so they slide with the blocks they
// join. The SVG is the reference's: x in tenths of a percent of the track
// (0–1000, stretched with preserveAspectRatio="none") and y in px, strokes
// kept crisp with vector-effect. Caps are HTML on top, so a dot stays round
// and an arrow stays sharp however the SVG is stretched.
import { memo } from "react";
import type { HandoffLineStyle, HandoffLineStyles } from "../../shared/view";
import type { Curve, RowLayout } from "./layout";
import { handoffPath, lineColor } from "./layout";
import { layerPercent } from "./time";

const MIN_PULL_PX = 24;
const STUB_PX = 44;

export interface CurvesProps {
  curves: readonly Curve[];
  layout: RowLayout;
  anchor: number;
  span: number;
  width: number;
  uid: string;
  styles: HandoffLineStyles;
}

export const Curves = memo(function Curves({ curves, layout, anchor, span, width, uid, styles }: CurvesProps) {
  const unitsPerPx = 1000 / Math.max(1, width);
  const x = (t: number) => layerPercent(t, anchor, span) * 10;
  const yOf = (row: number) => layout.tops[row]! + layout.heights[row]! / 2;
  const paths = curves.map((curve) => {
    const style = styles[curve.handoff.kind];
    const color = lineColor(style.color, curve.targetStatus);
    if (curve.from.row !== null && curve.to.row !== null) {
      const d = handoffPath(x(curve.from.t), yOf(curve.from.row), x(curve.to.t), yOf(curve.to.row), unitsPerPx, MIN_PULL_PX);
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

/** The caps at either end of each line: a pin on the sender, an arrow into the target. */
export const CurveCaps = memo(function CurveCaps({
  curves,
  layout,
  anchor,
  span,
  styles,
}: Omit<CurvesProps, "width" | "uid">) {
  const yOf = (row: number) => layout.tops[row]! + layout.heights[row]! / 2;
  return (
    <>
      {curves.map((curve) => {
        const style = styles[curve.handoff.kind];
        const color = lineColor(style.color, curve.targetStatus);
        return (
          <span key={curve.handoff.id} className="bl-caps" data-h={curve.handoff.id} data-color={color}>
            {curve.from.row !== null && (
              <Cap kind={style.start} at="start" left={layerPercent(curve.from.t, anchor, span)} top={yOf(curve.from.row)} />
            )}
            {curve.to.row !== null && (
              <Cap kind={style.end} at="end" left={layerPercent(curve.to.t, anchor, span)} top={yOf(curve.to.row)} />
            )}
          </span>
        );
      })}
    </>
  );
});

function Cap({ kind, at, left, top }: { kind: HandoffLineStyle["start"]; at: "start" | "end"; left: number; top: number }) {
  if (kind === "none") return null;
  return (
    <span className="bl-cap" data-cap={kind} data-at={at} style={{ left: `${left}%`, top }}>
      {kind === "arrow" && (
        <svg width="6" height="8" viewBox="0 0 6 8" aria-hidden="true">
          <path d="M1 1 L5 4 L1 7" />
        </svg>
      )}
    </span>
  );
}

function stubGradientId(uid: string, handoffId: string): string {
  return `${uid}-stub-${handoffId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
