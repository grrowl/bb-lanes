// The row of controls inside the card, above the timeline: how lanes are
// grouped, which lanes show, search, and density. On a narrow pane it
// condenses to the search field and one View menu.
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";
import { LinesMenu } from "./LinesMenu";
import { GROUP_MODES, LANE_FILTERS, type GroupMode, type LaneFilter } from "../grouping/types";
import type { SurfaceActions, SurfaceState } from "../surface-store";

export interface FilterCounts {
  waiting: number;
  failed: number;
}

export interface ToolbarProps {
  state: SurfaceState;
  actions: SurfaceActions;
  counts: FilterCounts;
  groupIds: readonly string[];
  /** Narrow pane: one menu instead of the full row. */
  condensed: boolean;
  /** Controls that live in the title bar elsewhere (span, live) when there is none. */
  trailing?: ReactNode;
  searchRef: RefObject<HTMLInputElement | null>;
  status: { indexing: boolean; historyError: string | null; onRetry(): void };
}

function Check({ on }: { on: boolean }) {
  return <Icon name="Check" className={cn("ml-auto size-3.5", on ? "opacity-100" : "opacity-0")} aria-hidden />;
}

function GroupItems({ value, onChange }: { value: GroupMode; onChange(mode: GroupMode): void }) {
  return GROUP_MODES.map((mode) => (
    <DropdownMenuItem key={mode.id} onSelect={() => onChange(mode.id)} aria-current={mode.id === value ? "true" : undefined}>
      <Icon name={mode.icon} aria-hidden />
      {mode.label}
      <Check on={mode.id === value} />
    </DropdownMenuItem>
  ));
}

function filterCount(filter: LaneFilter, counts: FilterCounts): number {
  if (filter === "needs-you") return counts.waiting;
  if (filter === "failed") return counts.failed;
  return 0;
}

function FilterChips({ value, counts, onChange }: { value: LaneFilter; counts: FilterCounts; onChange(filter: LaneFilter): void }) {
  return (
    <div role="radiogroup" aria-label="Show lanes" className="flex items-center gap-0.5 rounded-lg bg-surface-recessed p-0.5">
      {LANE_FILTERS.map((filter) => {
        const selected = filter.id === value;
        const count = filterCount(filter.id, counts);
        return (
          <button
            key={filter.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(filter.id)}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium leading-4 whitespace-nowrap outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "bg-card text-foreground shadow-[var(--lanes-tile-shadow)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {filter.label}
            {count > 0 ? (
              <span
                className={cn(
                  "lanes-toned tabular-nums",
                  filter.id === "needs-you" ? "lanes-tone-warn" : "lanes-tone-danger",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SearchField({
  value,
  onChange,
  inputRef,
  className,
}: {
  value: string;
  onChange(query: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <label className={cn("relative flex h-7 min-w-0 items-center", className)}>
      <Icon name="Search" className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (value !== "") onChange("");
            else event.currentTarget.blur();
          }
        }}
        placeholder="Search lanes"
        aria-label="Search lanes by title, project, model, or branch"
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        className="peer h-7 w-full min-w-0 rounded-md border border-input bg-transparent pl-7 pr-7 text-[12px] leading-4 text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {value === "" ? (
        <kbd className="pointer-events-none absolute right-1.5 grid h-4 min-w-4 place-items-center rounded border border-border px-1 font-sans text-[10px] leading-none text-muted-foreground peer-focus:opacity-0">
          /
        </kbd>
      ) : (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-1 grid size-5 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="X" className="size-3" aria-hidden />
        </button>
      )}
    </label>
  );
}

function StatusNote({ status }: { status: ToolbarProps["status"] }) {
  if (status.historyError !== null) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground" role="status">
        <span className="lanes-tone-danger lanes-dot" aria-hidden="true" />
        <span className="truncate" title={status.historyError}>
          History unavailable
        </span>
        <button
          type="button"
          onClick={status.onRetry}
          className="rounded font-medium text-foreground underline decoration-border underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          Retry
        </button>
      </span>
    );
  }
  if (status.indexing) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] leading-4 text-muted-foreground" role="status">
        <Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Indexing older turns
      </span>
    );
  }
  return null;
}

export function Toolbar({ state, actions, counts, groupIds, condensed, trailing, searchRef, status }: ToolbarProps) {
  const groupLabel = GROUP_MODES.find((mode) => mode.id === state.groupMode)?.label ?? "Project";
  const compact = state.density === "compact";
  const anyExpanded = groupIds.some((id) => !state.collapsedGroups.includes(id));

  const groupMenu = (
    <DropdownMenu open={state.groupMenuOpen} onOpenChange={actions.setGroupMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]" aria-keyshortcuts="g">
          <span className="text-muted-foreground">Group</span>
          <span className="font-medium text-foreground">{groupLabel}</span>
          <Icon name="ChevronDown" className="size-3 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44" mobileTitle="Group by">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Group by</DropdownMenuLabel>
        <GroupItems value={state.groupMode} onChange={actions.setGroupMode} />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const linesMenu = (
    <LinesMenu
      styles={state.lineStyles}
      onChange={actions.setLineStyle}
      onReset={actions.resetLineStyles}
      iconOnly={condensed}
    />
  );

  const collapseItems =
    groupIds.length > 0 ? (
      <>
        <DropdownMenuItem onSelect={() => actions.setGroupsCollapsed(groupIds, false)}>
          <Icon name="ChevronsDown" aria-hidden />
          Expand all groups
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.setGroupsCollapsed(groupIds, true)} disabled={!anyExpanded}>
          <Icon name="ChevronsUp" aria-hidden />
          Collapse all groups
        </DropdownMenuItem>
      </>
    ) : null;

  if (condensed) {
    return (
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <SearchField value={state.query} onChange={actions.setQuery} inputRef={searchRef} className="flex-1" />
        <StatusNote status={status} />
        {trailing}
        {linesMenu}
        {/* The View menu holds Group by here, so the `g` key opens it. */}
        <DropdownMenu open={state.groupMenuOpen} onOpenChange={actions.setGroupMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]" aria-label="View options" aria-keyshortcuts="g">
              <Icon name="SlidersHorizontal" className="size-3.5" aria-hidden />
              {state.filter === "active" ? null : (
                <span className="lanes-dot lanes-tone-run" aria-hidden="true" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52" mobileTitle="View">
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Show</DropdownMenuLabel>
            {LANE_FILTERS.map((filter) => (
              <DropdownMenuItem key={filter.id} onSelect={() => actions.setFilter(filter.id)}>
                {filter.label}
                {filterCount(filter.id, counts) > 0 ? (
                  <span className="tabular-nums text-muted-foreground">{filterCount(filter.id, counts)}</span>
                ) : null}
                <Check on={filter.id === state.filter} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Group by</DropdownMenuLabel>
            <GroupItems value={state.groupMode} onChange={actions.setGroupMode} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.setDensity(compact ? "comfortable" : "compact")}>
              <Icon name="Rows2" aria-hidden />
              Compact rows
              <Check on={compact} />
            </DropdownMenuItem>
            {collapseItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-2">
      {groupMenu}
      {linesMenu}
      <FilterChips value={state.filter} counts={counts} onChange={actions.setFilter} />
      <SearchField value={state.query} onChange={actions.setQuery} inputRef={searchRef} className="w-56 max-w-[40%]" />
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <StatusNote status={status} />
        {trailing}
        <Hint label={compact ? "Comfortable rows" : "Compact rows"}>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 px-0"
            aria-pressed={compact}
            aria-label="Compact rows"
            onClick={() => actions.setDensity(compact ? "comfortable" : "compact")}
          >
            <Icon name="Rows2" className="size-3.5" aria-hidden />
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-7 px-0" aria-label="More options">
              <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {collapseItems}
            {collapseItems === null ? null : <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Keyboard</DropdownMenuLabel>
            <DropdownMenuItem disabled>
              Window span
              <DropdownMenuShortcut>1 – 5</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Group by
              <DropdownMenuShortcut>G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Search
              <DropdownMenuShortcut>/</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
