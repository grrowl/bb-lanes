// The names column cells: what each row is, drawn by the shell and placed by
// the engine. A lane cell is upstream's agent cell (avatar, name with its
// state tag, model line) with a tree guide for sub-threads; a group cell is a
// one-line bar for its group, with upstream's summary.
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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import type { GroupRow, LaneRow } from "../../../shared/view";
import type { ProviderInfo } from "../data/useLanesData";
import type { GroupMeta, LaneMeta, LaneState } from "../grouping/types";
import { Chevron } from "./glyphs";
import { ProviderAvatar } from "./ProviderAvatar";
import { openModifier, threadSplit } from "../../../lib/thread-opening";

const STATE_LABEL: Record<LaneState, string | null> = {
  idle: "Idle",
  running: null,
  starting: "Starting",
  waiting: "Needs you",
  failed: "Failed",
  queued: "Queued",
};

/** Upstream's cell geometry: 16px in, a 26px avatar, and one avatar-and-gap per tree level. */
const INSET = 16;
const AVATAR = 26;
const LEVEL = 22;
const avatarCentre = (depth: number) => INSET + depth * LEVEL + AVATAR / 2;

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

export type SummaryKind = "running" | "needs" | "failed" | "lanes";

/** Upstream's summary line: only the parts that are not zero, then the lane count. */
export function groupSummary(counts: GroupRow["counts"]): { kind: SummaryKind; text: string }[] {
  const parts: { kind: SummaryKind; text: string }[] = [];
  if (counts.running > 0) parts.push({ kind: "running", text: `${counts.running} running` });
  if (counts.waiting > 0) parts.push({ kind: "needs", text: `${counts.waiting} need you` });
  if (counts.failed > 0) parts.push({ kind: "failed", text: `${counts.failed} failed` });
  parts.push({ kind: "lanes", text: `${counts.total} ${counts.total === 1 ? "lane" : "lanes"}` });
  return parts;
}

export function GroupSummary({ counts }: { counts: GroupRow["counts"] }) {
  return (
    <span className="lanes-summary">
      {groupSummary(counts).map((part) => (
        <span key={part.kind} data-kind={part.kind === "lanes" ? undefined : part.kind}>
          {part.text}
        </span>
      ))}
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
  const summary = groupSummary(row.counts)
    .map((part) => part.text)
    .join(", ");
  return (
    <div className="lanes-group">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!row.collapsed}
        aria-label={`${row.label}${meta?.detail ? ` ${meta.detail}` : ""}, ${summary}`}
      >
        <Chevron collapsed={row.collapsed} />
        <span className="lanes-group-icon">
          {meta?.kind === "provider" ? (
            <ProviderAvatar provider={provider} fallbackName={row.label} size="small" />
          ) : (
            <Icon name={meta?.icon ?? "Folder"} aria-hidden />
          )}
        </span>
        <span className="lanes-group-label">
          {row.label}
          {meta?.detail ? <span className="lanes-group-detail">{meta.detail}</span> : null}
        </span>
        <GroupSummary counts={row.counts} />
      </button>
    </div>
  );
}

export interface LaneHeaderCellProps {
  openBeside?: boolean;
  row: LaneRow;
  thread: PluginSidebarThread;
  meta: LaneMeta | undefined;
  provider: ProviderInfo | undefined;
  subtitle: string;
  terms: readonly string[];
  highlighted: boolean;
  /** The row is hovered or focused: show its hover-only affordances. */
  revealed: boolean;
  actions: LaneActions;
}

/** Hairlines from each ancestor's avatar down to its children's, ending in a soft elbow. */
function TreeGuides({ row, meta }: { row: LaneRow; meta: LaneMeta | undefined }) {
  const guides: ReactNode[] = [];
  meta?.guides.forEach((continues, level) => {
    if (continues) guides.push(<span key={level} className="lanes-guide" style={{ top: 0, bottom: 0, left: avatarCentre(level) - 0.5 }} />);
  });
  if (row.depth > 0) {
    const x = avatarCentre(row.depth - 1) - 0.5;
    if (!row.isLastChild) guides.push(<span key="through" className="lanes-guide" style={{ top: 0, bottom: 0, left: x }} />);
    guides.push(
      <span
        key="elbow"
        className="lanes-guide"
        data-elbow=""
        style={{ top: 0, left: x, width: INSET + row.depth * LEVEL - 3 - x }}
      />,
    );
  }
  if (row.hasChildren && !row.collapsed) {
    guides.push(
      <span
        key="down"
        className="lanes-guide"
        style={{ top: `calc(50% + ${AVATAR / 2 + 3}px)`, bottom: 0, left: avatarCentre(row.depth) - 0.5 }}
      />,
    );
  }
  return <>{guides}</>;
}

export function LaneHeaderCell({
  openBeside = true,
  row,
  thread,
  meta,
  provider,
  subtitle,
  terms,
  highlighted,
  revealed,
  actions,
}: LaneHeaderCellProps) {
  const split = experimental_useSidebarThreadSplit(thread.id);

  const openFromClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    actions.open(thread.id, threadSplit(openBeside, event));
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="lanes-agent"
          style={{ paddingLeft: INSET + row.depth * LEVEL }}
          data-highlighted={highlighted ? "" : undefined}
        >
          <TreeGuides row={row} meta={meta} />
          <span className="lanes-avatar-slot">
            <ProviderAvatar provider={provider} fallbackName={thread.displayTitle} />
            {thread.isUnread ? <span className="lanes-unread" role="img" aria-label="Unread" /> : null}
            {row.hasChildren ? (
              <button
                type="button"
                className="lanes-disclose"
                data-show={row.collapsed || revealed ? "" : undefined}
                onClick={() => actions.toggleLane(thread.id)}
                aria-expanded={!row.collapsed}
                aria-label={row.collapsed ? "Show sub-threads" : "Hide sub-threads"}
              >
                <Chevron collapsed={row.collapsed} />
              </button>
            ) : null}
          </span>
          <span className="lanes-who">
            <span className="lanes-name-line" data-state={row.state}>
              <a
                href={thread.href}
                {...split.splitProps}
                onClick={openFromClick}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    actions.open(thread.id, !openBeside);
                  }
                }}
                title={thread.displayTitle}
                className="lanes-name"
                data-context={meta?.matched === false ? "" : undefined}
              >
                {terms.length > 0 ? <Highlighted text={thread.displayTitle} terms={terms} /> : <ThreadTitle threadId={thread.id} />}
              </a>
              <StateTag state={row.state} />
            </span>
            <span className="lanes-model">
              <span>
                <Highlighted text={subtitle} terms={terms} />
              </span>
            </span>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="bl-theme lanes-menu">
        {split.isAvailable ? (
          <>
            <ContextMenuItem onSelect={() => actions.open(thread.id, true)}>
              <Icon name="Columns2" aria-hidden />
              Open beside
              <span className="lanes-menu-key">{openBeside ? "Click" : `${openModifier()} Click`}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.open(thread.id, false)}>
              <Icon name="MessageSquare" aria-hidden />
              Open here
              <span className="lanes-menu-key">{openBeside ? `${openModifier()} Click` : "Click"}</span>
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onSelect={() => actions.open(thread.id, false)}>
            <Icon name="MessageSquare" aria-hidden />
            Open
          </ContextMenuItem>
        )}
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
