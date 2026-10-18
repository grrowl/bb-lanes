// The names column cells: what each row is, drawn by the shell and placed by
// the engine. Group cells disclose their lanes; lane cells carry the thread's
// identity, live state tag, and actions.
import { useRef, type MouseEvent, type ReactNode } from "react";
import {
  experimental_useSidebarThreadSplit,
  ThreadTitle,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { GroupRow, LaneRow, RowDensity } from "../../../shared/view";
import type { ProviderInfo } from "../data/useLanesData";
import type { GroupMeta, LaneMeta, LaneState } from "../grouping/types";
import { WaitingGlyph } from "./glyphs";
import { ProviderAvatar } from "./ProviderAvatar";

const STATE_LABEL: Record<LaneState, string | null> = {
  idle: "Idle",
  running: null,
  starting: "Starting",
  waiting: "Needs you",
  failed: "Failed",
  queued: "Queued",
};

export interface LaneActions {
  open(threadId: string, split: boolean): void;
  toggleGroup(groupId: string): void;
  toggleLane(threadId: string): void;
  setPinned(threadId: string, pinned: boolean): void;
  setRead(threadId: string, read: boolean): void;
  archive(threadId: string): void;
}

/** Collapses away while the agent works; the last label lingers as it goes. */
export function StateTag({ state }: { state: LaneState }) {
  const label = STATE_LABEL[state];
  const lastLabel = useRef(label ?? "Idle");
  if (label !== null) lastLabel.current = label;
  const show = label !== null;
  return (
    <span className="lanes-state" data-show={show ? "" : undefined} data-state={state} aria-hidden={!show}>
      <span>{lastLabel.current}</span>
    </span>
  );
}

/** `text` with every search term marked. */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      marked.fill(true, at, at + term.length);
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      const slice = text.slice(start, index);
      parts.push(marked[start] ? <mark key={start} className="lanes-mark">{slice}</mark> : slice);
      start = index;
    }
  }
  return <>{parts}</>;
}

export function GroupCounts({ counts }: { counts: GroupRow["counts"] }) {
  return (
    <span className="lanes-group-text flex flex-none items-center gap-2 text-[11px] font-medium leading-4 tabular-nums">
      {counts.waiting > 0 ? (
        <span className="lanes-tone-warn lanes-toned inline-flex items-center gap-1" aria-label={`${counts.waiting} need you`}>
          <WaitingGlyph />
          {counts.waiting}
        </span>
      ) : null}
      {counts.running > 0 ? (
        <span className="lanes-tone-run lanes-toned inline-flex items-center gap-1.5" aria-label={`${counts.running} running`}>
          <span className="lanes-dot" />
          {counts.running}
        </span>
      ) : null}
      {counts.failed > 0 ? (
        <span className="lanes-tone-danger lanes-toned inline-flex items-center gap-1" aria-label={`${counts.failed} failed`}>
          <Icon name="X" className="size-3" aria-hidden />
          {counts.failed}
        </span>
      ) : null}
      <span className="text-muted-foreground" aria-label={`${counts.total} ${counts.total === 1 ? "lane" : "lanes"}`}>
        {counts.total}
      </span>
    </span>
  );
}

export function GroupHeaderCell({
  row,
  meta,
  provider,
  onToggle,
}: {
  row: GroupRow;
  meta: GroupMeta | undefined;
  provider: ProviderInfo | undefined;
  onToggle(): void;
}) {
  return (
    <div className="lanes-cell gap-2 pl-3 pr-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!row.collapsed}
        aria-label={`${row.label}, ${row.counts.total} ${row.counts.total === 1 ? "lane" : "lanes"}`}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="lanes-chevron grid size-3.5 flex-none place-items-center text-muted-foreground" data-collapsed={row.collapsed ? "" : undefined}>
          <Icon name="ChevronDown" className="size-3.5" aria-hidden />
        </span>
        {meta?.kind === "provider" ? (
          <span className="flex-none scale-[0.7] -mx-1">
            <ProviderAvatar provider={provider} fallbackName={row.label} />
          </span>
        ) : (
          <Icon name={meta?.icon ?? "Folder"} className="size-3.5 flex-none text-muted-foreground" aria-hidden />
        )}
        <span className="lanes-group-text min-w-0 truncate text-[12px] font-semibold leading-4 text-foreground">
          {row.label}
          {meta?.detail ? <span className="ml-1.5 font-normal text-muted-foreground">{meta.detail}</span> : null}
        </span>
      </button>
      <GroupCounts counts={row.counts} />
    </div>
  );
}

export interface LaneHeaderCellProps {
  row: LaneRow;
  thread: PluginSidebarThread;
  meta: LaneMeta | undefined;
  provider: ProviderInfo | undefined;
  subtitle: string;
  terms: readonly string[];
  density: RowDensity;
  highlighted: boolean;
  /** The row is hovered or focused: show its hover-only affordances. */
  revealed: boolean;
  actions: LaneActions;
}

export function LaneHeaderCell({
  row,
  thread,
  meta,
  provider,
  subtitle,
  terms,
  density,
  highlighted,
  revealed,
  actions,
}: LaneHeaderCellProps) {
  const split = experimental_useSidebarThreadSplit(thread.id);
  const avatar = density === "compact" ? 22 : 26;
  const step = density === "compact" ? 18 : 22;
  const inset = 12;
  const centre = (depth: number) => inset + depth * step + avatar / 2 - 0.5;

  const openFromClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    actions.open(thread.id, event.metaKey || event.ctrlKey);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn("lanes-cell gap-2.5 pr-3", meta?.matched === false && "opacity-70")}
          style={{ paddingLeft: inset + row.depth * step }}
          data-highlighted={highlighted ? "" : undefined}
        >
          {highlighted ? (
            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--lanes-run)]" aria-hidden="true" />
          ) : null}
          {meta?.guides.map((continues, index) =>
            continues ? (
              <span key={index} className="lanes-guide inset-y-0 w-px" style={{ left: centre(index) }} />
            ) : null,
          )}
          {row.depth > 0 ? (
            <>
              <span
                className="lanes-guide top-0 w-px"
                style={{ left: centre(row.depth - 1), bottom: row.isLastChild ? "50%" : 0 }}
              />
              <span
                className="lanes-guide top-1/2 h-px"
                style={{ left: centre(row.depth - 1), width: inset + row.depth * step - centre(row.depth - 1) - 2 }}
              />
            </>
          ) : null}
          {row.hasChildren && !row.collapsed ? (
            <span className="lanes-guide bottom-0 w-px" style={{ left: centre(row.depth), top: `calc(50% + ${avatar / 2}px)` }} />
          ) : null}

          <span className="relative flex-none">
            <ProviderAvatar provider={provider} fallbackName={thread.displayTitle} />
            {row.hasChildren ? (
              <button
                type="button"
                onClick={() => actions.toggleLane(thread.id)}
                aria-expanded={!row.collapsed}
                aria-label={row.collapsed ? "Show sub-threads" : "Hide sub-threads"}
                className={cn(
                  "absolute -bottom-1.5 left-1/2 grid size-3.5 -translate-x-1/2 place-items-center rounded-full bg-card text-muted-foreground shadow-[var(--lanes-tile-shadow)] outline-none transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring",
                  row.collapsed || revealed ? "opacity-100" : "opacity-0",
                )}
              >
                <span className="lanes-chevron grid place-items-center" data-collapsed={row.collapsed ? "" : undefined}>
                  <Icon name="ChevronDown" className="size-2.5" aria-hidden />
                </span>
              </button>
            ) : null}
          </span>

          <span className="lanes-who">
            <span className="flex min-w-0 items-center">
              <a
                href={thread.href}
                {...split.splitProps}
                onClick={openFromClick}
                title={thread.displayTitle}
                className={cn(
                  "min-w-0 truncate rounded-sm text-[14px] font-medium leading-5 outline-none decoration-border underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:ring-ring",
                  meta?.matched === false ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {terms.length > 0 ? <Highlighted text={thread.displayTitle} terms={terms} /> : <ThreadTitle threadId={thread.id} />}
              </a>
              {thread.isUnread && row.state === "idle" ? (
                <span className="ml-1.5 size-[5px] flex-none rounded-full bg-muted-foreground/60" role="img" aria-label="Unread" />
              ) : null}
              <StateTag state={row.state} />
            </span>
            <span className="min-w-0 truncate text-[12px] leading-4 text-muted-foreground">
              <Highlighted text={subtitle} terms={terms} />
            </span>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem onSelect={() => actions.open(thread.id, false)}>
          <Icon name="MessageSquare" aria-hidden />
          Open
        </ContextMenuItem>
        {split.isAvailable ? (
          <ContextMenuItem onSelect={() => actions.open(thread.id, true)}>
            <Icon name="Columns2" aria-hidden />
            Open in split
            <ContextMenuShortcut>⌘ click</ContextMenuShortcut>
          </ContextMenuItem>
        ) : null}
        {row.hasChildren ? (
          <ContextMenuItem onSelect={() => actions.toggleLane(thread.id)}>
            <Icon name={row.collapsed ? "Eye" : "EyeOff"} aria-hidden />
            {row.collapsed ? "Show sub-threads" : "Hide sub-threads"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.setPinned(thread.id, !thread.isPinned)}>
          <Icon name={thread.isPinned ? "PinOff" : "Pin"} aria-hidden />
          {thread.isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.setRead(thread.id, thread.isUnread)}>
          <Icon name={thread.isUnread ? "MailOpen" : "Mail"} aria-hidden />
          {thread.isUnread ? "Mark as read" : "Mark as unread"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.archive(thread.id)}>
          <Icon name="Archive" aria-hidden />
          Archive
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
