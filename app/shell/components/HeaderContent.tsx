// Lives in bb's shared title bar beside "Lanes": what is going on right now,
// the window span, and whether the window follows the clock. Shares state with
// the pane body through the surface store.
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";
import { useLiveCounts } from "../data/live-counts";
import { useSurface } from "../surface-store";
import { formatDuration, presetForSpan, SPAN_PRESETS } from "../time";

/** `menu` always uses the compact dropdown (narrow surfaces such as a side panel). */
export function SpanControl({
  span,
  onChange,
  menu = false,
}: {
  span: number;
  onChange(span: number): void;
  menu?: boolean;
}) {
  const current = presetForSpan(span);
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Window"
        className={cn("items-center gap-0.5 rounded-lg bg-surface-recessed p-0.5", menu ? "hidden" : "hidden sm:flex")}
      >
        {SPAN_PRESETS.map((preset) => {
          const selected = current?.ms === preset.ms;
          return (
            <button
              key={preset.ms}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Last ${preset.long}`}
              aria-keyshortcuts={preset.key}
              title={`Last ${preset.long} (${preset.key})`}
              onClick={() => onChange(preset.ms)}
              className={cn(
                "h-6 min-w-8 rounded-md px-1.5 text-[12px] font-medium leading-4 tabular-nums outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-1 focus-visible:ring-ring",
                selected
                  ? "bg-card text-foreground shadow-[var(--lanes-tile-shadow)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7 gap-1 px-2 text-[12px] tabular-nums", !menu && "sm:hidden")}
            aria-label="Window"
          >
            {current?.label ?? formatDuration(span)}
            <Icon name="ChevronDown" className="size-3 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" mobileTitle="Window">
          {SPAN_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.ms} onSelect={() => onChange(preset.ms)}>
              Last {preset.long}
              <Icon
                name="Check"
                className={cn("ml-auto size-3.5", current?.ms === preset.ms ? "opacity-100" : "opacity-0")}
                aria-hidden
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function LiveControl({ live, onGoLive }: { live: boolean; onGoLive(): void }) {
  if (live) {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[12px] font-medium leading-4 text-muted-foreground" role="status">
        <span className="lanes-dot lanes-tone-run" aria-hidden="true" />
        Live
      </span>
    );
  }
  return (
    <Hint label="Follow the clock again" shortcut="N">
      <Button variant="outline" size="sm" className="lanes-rise h-7 gap-1.5 px-2 text-[12px]" onClick={onGoLive} aria-keyshortcuts="n">
        <Icon name="ArrowRight" className="size-3.5" aria-hidden />
        Jump to now
      </Button>
    </Hint>
  );
}

export function LanesHeaderContent() {
  const [state, actions] = useSurface("lanes");
  const counts = useLiveCounts();
  return (
    <div className="lanes-chrome flex items-center gap-3">
      <div className="hidden items-center gap-3 text-[12px] leading-4 tabular-nums md:flex">
        <button
          type="button"
          onClick={() => actions.setFilter("active")}
          className="lanes-tone-run inline-flex items-center gap-1.5 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          title="Show active lanes"
        >
          <span className="lanes-dot" aria-hidden="true" />
          {counts.running} running
        </button>
        {counts.waiting > 0 ? (
          <button
            type="button"
            onClick={() => actions.setFilter("needs-you")}
            className="lanes-tone-warn lanes-toned lanes-rise inline-flex items-center gap-1.5 rounded font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="Show lanes that need you"
          >
            <span className="lanes-dot" aria-hidden="true" />
            {counts.waiting} need you
          </button>
        ) : null}
      </div>
      <SpanControl span={state.span} onChange={actions.setSpan} />
      <LiveControl live={state.live} onGoLive={actions.goLive} />
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
    <span className="lanes-chrome flex items-center justify-end gap-1.5 text-[11px] font-medium leading-4 tabular-nums" aria-label={label} title={label}>
      {counts.running > 0 ? <span className="text-muted-foreground">{counts.running}</span> : null}
      {counts.waiting > 0 ? (
        <span className="lanes-tone-warn lanes-toned inline-flex items-center gap-1">
          <span className="lanes-dot" aria-hidden="true" />
          {counts.waiting}
        </span>
      ) : null}
    </span>
  );
}
