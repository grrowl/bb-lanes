// Hand-off curves live in the moving layer's SVG, so they slide with the
// blocks they join. x is in tenths of a percent of the track (the reference's
// 0–1000 viewBox stretched with preserveAspectRatio="none"), y is in px.
import { memo } from "react";
import type { Curve, RowLayout } from "./layout";
import { curvePath } from "./layout";
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
}

export const Curves = memo(function Curves({ curves, layout, anchor, span, width, uid }: CurvesProps) {
  const unitsPerPx = 1000 / Math.max(1, width);
  const x = (t: number) => layerPercent(t, anchor, span) * 10;
  const yOf = (row: number) => layout.tops[row]! + layout.heights[row]! / 2;
  return (
    <svg
      className="bl-curves"
      viewBox={`0 0 1000 ${Math.max(1, layout.total)}`}
      preserveAspectRatio="none"
      style={{ height: layout.total }}
      aria-hidden="true"
    >
      <defs>
        {curves.map((curve) => {
          if (curve.from.row !== null && curve.to.row !== null) return null;
          const known = curve.from.row ?? curve.to.row!;
          const x0 = curve.to.row === null ? x(curve.from.t) : x(curve.to.t) - STUB_PX * unitsPerPx;
          const fadeOut = curve.to.row === null;
          return (
            <linearGradient
              key={curve.handoff.id}
              id={stubGradientId(uid, curve.handoff.id)}
              gradientUnits="userSpaceOnUse"
              x1={x0}
              x2={x0 + STUB_PX * unitsPerPx}
              y1={yOf(known)}
              y2={yOf(known)}
            >
              <stop offset="0" stopColor="currentColor" stopOpacity={fadeOut ? 1 : 0} />
              <stop offset="1" stopColor="currentColor" stopOpacity={fadeOut ? 0 : 1} />
            </linearGradient>
          );
        })}
      </defs>
      {curves.map((curve) => {
        const { handoff } = curve;
        let d: string;
        let stub = false;
        if (curve.from.row !== null && curve.to.row !== null) {
          d = curvePath(x(curve.from.t), yOf(curve.from.row), x(curve.to.t), yOf(curve.to.row), MIN_PULL_PX * unitsPerPx);
        } else if (curve.from.row !== null) {
          // The recipient is not shown: a short tail leaving the sender, fading out.
          const x1 = x(curve.from.t);
          const y = yOf(curve.from.row);
          d = `M ${x1} ${y} C ${x1 + 20 * unitsPerPx} ${y}, ${x1 + 26 * unitsPerPx} ${y + 10}, ${x1 + STUB_PX * unitsPerPx} ${y + 12}`;
          stub = true;
        } else {
          const x2 = x(curve.to.t);
          const y = yOf(curve.to.row!);
          d = `M ${x2 - STUB_PX * unitsPerPx} ${y - 12} C ${x2 - 26 * unitsPerPx} ${y - 10}, ${x2 - 20 * unitsPerPx} ${y}, ${x2} ${y}`;
          stub = true;
        }
        return (
          <path
            key={handoff.id}
            className="bl-curve"
            d={d}
            data-h={handoff.id}
            data-kind={handoff.kind}
            data-live={curve.live ? "" : undefined}
            data-stub={stub ? "" : undefined}
            data-proxy={curve.from.proxy || curve.to.proxy ? "" : undefined}
            stroke={stub ? `url(#${stubGradientId(uid, handoff.id)})` : undefined}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
});

/** Arrival dots at the start of each recipient turn: HTML, so they stay round. */
export const CurveDots = memo(function CurveDots({
  curves,
  layout,
  anchor,
  span,
}: Omit<CurvesProps, "width" | "uid">) {
  return (
    <>
      {curves.map((curve) =>
        curve.to.row === null ? null : (
          <span
            key={curve.handoff.id}
            className="bl-dot"
            data-h={curve.handoff.id}
            data-live={curve.live ? "" : undefined}
            style={{
              left: `${layerPercent(curve.to.t, anchor, span)}%`,
              top: layout.tops[curve.to.row]! + layout.heights[curve.to.row]! / 2,
            }}
          />
        ),
      )}
    </>
  );
});

function stubGradientId(uid: string, handoffId: string): string {
  return `${uid}-stub-${handoffId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
