// The bar on the tray, above the card: upstream's bar grown into the pane's
// controls. How lanes are grouped, which lanes show, and search sit on the
// left as quiet tray controls; the window pill ("Last 15m") sits on the right
// as upstream's does, and opens the spans. On a narrow pane the controls
// condense to search and one View menu.
import { useRef, useState, type ReactNode, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { GROUP_MODES, LANE_FILTERS, type GroupMode, type LaneFilter } from "../grouping/types";
import type { SurfaceActions, SurfaceState } from "../surface-store";
import { formatDuration, formatWindow, presetForSpan, SPAN_PRESETS } from "../time";
import { CheckGlyph, Chevron, CloseGlyph, MoreGlyph, SearchGlyph } from "./glyphs";
import { openModifier } from "../../../lib/thread-opening";

export interface FilterCounts {
  waiting: number;
  failed: number;
}

export interface ToolbarProps {
  openBeside: boolean;
  onOpenBesideChange(open: boolean): void;
  state: SurfaceState;
  actions: SurfaceActions;
  counts: FilterCounts;
  groupIds: readonly string[];
  /** Narrow pane: one menu instead of the full row. */
  condensed: boolean;
  /** Leads the bar where no title bar carries it (the team panel). */
  summary?: ReactNode;
  searchRef: RefObject<HTMLInputElement | null>;
  status: { indexing: boolean; historyError: string | null; reconnecting: boolean; onRetry(): void };
}

const MENU = "bl-theme lanes-menu";

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="lanes-menu-label">{children}</div>;
}

function GroupItems({ value, onChange }: { value: GroupMode; onChange(mode: GroupMode): void }) {
  return GROUP_MODES.map((mode) => (
    <DropdownMenuItem key={mode.id} onSelect={() => onChange(mode.id)} role="menuitemradio" aria-checked={mode.id === value}>
      <Icon name={mode.icon} aria-hidden />
      {mode.label}
      <CheckGlyph off={mode.id !== value} />
    </DropdownMenuItem>
  ));
}

function filterCount(filter: LaneFilter, counts: FilterCounts): { kind: "needs" | "failed"; count: number } | null {
  if (filter === "needs-you" && counts.waiting > 0) return { kind: "needs", count: counts.waiting };
  if (filter === "failed" && counts.failed > 0) return { kind: "failed", count: counts.failed };
  return null;
}

function FilterPills({ value, counts, onChange }: { value: LaneFilter; counts: FilterCounts; onChange(filter: LaneFilter): void }) {
  return (
    <div role="radiogroup" aria-label="Show lanes" className="lanes-seg">
      {LANE_FILTERS.map((filter) => {
        const count = filterCount(filter.id, counts);
        return (
          <button
            key={filter.id}
            type="button"
            role="radio"
            aria-checked={filter.id === value}
            tabIndex={filter.id === value ? 0 : -1}
            onClick={() => onChange(filter.id)}
            onKeyDown={(event) => {
              const index = LANE_FILTERS.findIndex((item) => item.id === filter.id);
              const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
              const next = event.key === "Home" ? 0 : event.key === "End" ? LANE_FILTERS.length - 1
                : direction !== 0 ? (index + direction + LANE_FILTERS.length) % LANE_FILTERS.length : null;
              if (next === null) return;
              event.preventDefault();
              onChange(LANE_FILTERS[next]!.id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']")[next]?.focus();
            }}
          >
            {filter.label}
            {count !== null ? (
              <span className="lanes-seg-count" data-kind={count.kind}>
                {count.count}
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
  wide = false,
}: {
  value: string;
  onChange(query: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  wide?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <label className="lanes-search" data-wide={wide ? "" : undefined}>
      <SearchGlyph className="lanes-search-glyph" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          const previous = event.relatedTarget;
          if (previous instanceof HTMLElement && !event.currentTarget.parentElement?.contains(previous)) {
            returnFocus.current = previous;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (value !== "") onChange("");
            else {
              const previous = returnFocus.current;
              const scope = event.currentTarget.closest("[data-lanes-shortcuts]");
              const restored = previous?.isConnected ? previous : Array.from(scope?.querySelectorAll<HTMLElement>("[data-nav], a[href]") ?? []).find((element) =>
                previous?.dataset.nav ? element.dataset.nav === previous.dataset.nav
                  : previous?.hasAttribute("href") && element.getAttribute("href") === previous.getAttribute("href"),
              );
              if (restored) restored.focus();
              else event.currentTarget.blur();
            }
          }
        }}
        placeholder="Search lanes"
        aria-label="Search lanes by title, project, model, or branch"
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
      />
      {value === "" ? (
        <kbd aria-hidden="true">/</kbd>
      ) : (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
        >
          <CloseGlyph />
        </button>
      )}
    </label>
  );
}

function StatusNote({ status }: { status: ToolbarProps["status"] }) {
  if (status.historyError !== null) {
    return (
      <span className="lanes-note" role="status">
        <span className="lanes-note-dot" aria-hidden="true" />
        <span title={status.historyError}>History unavailable</span>
        <button type="button" onClick={status.onRetry}>
          Retry
        </button>
      </span>
    );
  }
  if (status.reconnecting) {
    return <span className="lanes-note" role="status"><span className="lanes-note-dot" aria-hidden="true" />Reconnecting</span>;
  }
  if (status.indexing) {
    return (
      <span className="lanes-note" role="status">
        <span className="lanes-note-spin" aria-hidden="true" />
        Indexing older turns
      </span>
    );
  }
  return null;
}

/**
 * Upstream's window pill. Live it reads "Last 15m"; panned back it names the
 * stretch of time on screen, in the running colour, and Jump to now returns.
 */
export function WindowMenu({ state, actions }: { state: SurfaceState; actions: SurfaceActions }) {
  const [open, setOpen] = useState(false);
  const current = presetForSpan(state.span);
  const label = state.live ? `Last ${current?.label ?? formatDuration(state.span)}` : formatWindow(state.end, state.span);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="lanes-pill"
          data-history={state.live ? undefined : ""}
          aria-label={state.live ? `Window: ${label}` : `Window: ${label}, not following the clock`}
        >
          {label}
          <Chevron />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={`${MENU} lanes-window-menu`} mobileTitle="Window" onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
        const preset = SPAN_PRESETS.find((item) => item.key === event.key);
        if (preset) actions.setSpan(preset.ms);
        else if (event.key.toLowerCase() === "n") actions.goLive();
        else return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}>
        <MenuLabel>Window span</MenuLabel>
        {SPAN_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset.ms} role="menuitemradio" aria-checked={current?.ms === preset.ms} onSelect={() => actions.setSpan(preset.ms)}>
            {preset.name}
            <span className="lanes-menu-key">{preset.key}</span>
            <CheckGlyph off={current?.ms !== preset.ms} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={state.live} onSelect={actions.goLive}>
          Jump to now
          <span className="lanes-menu-key">N</span>
          <CheckGlyph off />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Toolbar({ state, actions, counts, groupIds, condensed, summary, searchRef, status, openBeside, onOpenBesideChange }: ToolbarProps) {
  const groupLabel = GROUP_MODES.find((mode) => mode.id === state.groupMode)?.label ?? "Project";
  const anyExpanded = groupIds.some((id) => !state.collapsedGroups.includes(id));
  const anyCollapsed = groupIds.some((id) => state.collapsedGroups.includes(id));

  const collapseItems =
    groupIds.length > 0 ? (
      <>
        <DropdownMenuItem onSelect={() => actions.setGroupsCollapsed(groupIds, false)} disabled={!anyCollapsed}>
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
      <div className="lanes-bar">
        {summary}
        <SearchField value={state.query} onChange={actions.setQuery} inputRef={searchRef} wide />
        <span className="lanes-bar-end">
          <StatusNote status={status} />
          <WindowMenu state={state} actions={actions} />
          {/* The View menu holds Group by here, so the `g` key opens it. */}
          <DropdownMenu open={state.groupMenuOpen} onOpenChange={actions.setGroupMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="lanes-quiet" data-icon-only="" aria-label="View options" aria-keyshortcuts="g">
                <Icon name="SlidersHorizontal" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={MENU} mobileTitle="View">
              <MenuLabel>Show</MenuLabel>
              {LANE_FILTERS.map((filter) => {
                const count = filterCount(filter.id, counts);
                return (
                  <DropdownMenuItem key={filter.id} role="menuitemradio" aria-checked={filter.id === state.filter} onSelect={() => actions.setFilter(filter.id)}>
                    {filter.label}
                    {count !== null ? (
                      <span className="lanes-seg-count" data-kind={count.kind}>
                        {count.count}
                      </span>
                    ) : null}
                    <CheckGlyph off={filter.id !== state.filter} />
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <MenuLabel>Group by</MenuLabel>
              <GroupItems value={state.groupMode} onChange={actions.setGroupMode} />
              {collapseItems === null ? null : <DropdownMenuSeparator />}
              {collapseItems}
              <DropdownMenuSeparator />
              <DropdownMenuItem role="menuitemcheckbox" aria-checked={openBeside} onSelect={() => onOpenBesideChange(!openBeside)}>
                Open to the side by default
                <CheckGlyph off={!openBeside} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    );
  }

  return (
    <div className="lanes-bar">
      {summary}
      <DropdownMenu open={state.groupMenuOpen} onOpenChange={actions.setGroupMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="lanes-quiet" aria-keyshortcuts="g" aria-label={`Group by ${groupLabel}`}>
            <span className="lanes-quiet-label">Group</span>
            {groupLabel}
            <Chevron />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={MENU} mobileTitle="Group by">
          <MenuLabel>Group by</MenuLabel>
          <GroupItems value={state.groupMode} onChange={actions.setGroupMode} />
          {collapseItems === null ? null : <DropdownMenuSeparator />}
          {collapseItems}
        </DropdownMenuContent>
      </DropdownMenu>
      <FilterPills value={state.filter} counts={counts} onChange={actions.setFilter} />
      <SearchField value={state.query} onChange={actions.setQuery} inputRef={searchRef} />
      <span className="lanes-bar-end">
        <StatusNote status={status} />
        <WindowMenu state={state} actions={actions} />
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="lanes-quiet" data-icon-only="" aria-label="Keyboard shortcuts">
              <MoreGlyph />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={4} className={`${MENU} lanes-shortcuts`} aria-label="Keyboard shortcuts" tabIndex={-1}>
              <MenuLabel>Keyboard shortcuts</MenuLabel>
              <dl>
                {KEYS.map(([what, keys]) => (
                  <div key={what}><dt>{what}</dt><dd><kbd>{keys}</kbd></dd></div>
                ))}
              </dl>
              <p>Focus a turn to move with the arrow keys.</p>
              <div className="lanes-shortcuts-divider" />
              <button type="button" role="checkbox" aria-checked={openBeside} className="lanes-opening-preference" onClick={() => onOpenBesideChange(!openBeside)}>
                Open to the side by default
                <CheckGlyph off={!openBeside} />
              </button>
              <p>{openModifier()}-click / {openModifier()}-Enter reverses this.</p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </span>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Window span", "1 – 5"],
  ["Group by", "G"],
  ["Search", "/"],
  ["Move between turns", "← → ↑ ↓"],
  ["Pan back and forth", "[  ]"],
  ["Zoom", "−  ="],
  ["Jump to now", "N"],
];
