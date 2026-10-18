// The time ruler and the matching grid lines. While live, ticks read "−5m"
// and stay put while the work slides beneath them (the reference's calm grid).
// Panned into history they become clock times that travel with the content.
import { memo, useMemo } from "react";
import type { Frame } from "./controller";
import { absoluteTicks, chooseTickStep, layerPercent, relativeTicks, type Tick } from "./time";

export interface PlacedTick extends Tick {
  /** Percent of the track (live) or of the moving layer (history). */
  x: number;
}

export function useTicks(frame: Frame): PlacedTick[] {
  const { live, span, width, anchor, from, to } = frame;
  return useMemo(() => {
    const step = chooseTickStep(span, width > 0 ? width : 960);
    if (live) {
      // Relative to a now of 0: t is minus the age, placed from the right edge.
      return relativeTicks(0, span, step).map((tick) => ({ ...tick, x: 100 + (tick.t / span) * 100 }));
    }
    return absoluteTicks(from, to, step).map((tick) => ({ ...tick, x: layerPercent(tick.t, anchor, span) }));
  }, [live, span, width, anchor, from, to]);
}

export const RulerTicks = memo(function RulerTicks({ ticks, live }: { ticks: PlacedTick[]; live: boolean }) {
  return (
    <>
      {ticks.map((tick) => (
        <span key={`${live ? "l" : "h"}${tick.t}`} className="bl-tick" style={{ left: `${tick.x}%` }}>
          <span className="bl-tick-label">{tick.label}</span>
        </span>
      ))}
    </>
  );
});

export const GridLines = memo(function GridLines({ ticks, live }: { ticks: PlacedTick[]; live: boolean }) {
  return (
    <>
      {ticks.map((tick) => (
        <span key={`${live ? "l" : "h"}${tick.t}`} className="bl-gridline" style={{ left: `${tick.x}%` }} />
      ))}
    </>
  );
});
