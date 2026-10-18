// The two popovers a block opens: the dark tooltip ("what got done") and the
// decision card for a turn that waits on a person. Both follow their block as
// the window slides; the controller calls `follow` after every transform.
import { useLayoutEffect, useRef } from "react";
import type { BlockDetail, LaneBlock } from "../../shared/model";
import type { ViewController } from "./controller";
import { STATUS_LABEL, blockDuration, blockTitle, plural } from "./labels";
import { clamp, formatDuration } from "./time";

type Describe = (threadId: string) => { title: string; subtitle: string | null };

export type DetailState = { status: "loading" } | { status: "ready"; detail: BlockDetail } | { status: "error" };

interface PlacementProps {
  block: LaneBlock;
  /** Row box in canvas px. */
  rowTop: number;
  rowHeight: number;
  /** Open above the row (it sits in the lower half of the view). */
  up: boolean;
  controller: ViewController;
}

function usePopoverPlacement(
  ref: React.RefObject<HTMLDivElement | null>,
  { block, controller }: PlacementProps,
  align: "center" | "end",
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const follow = () => {
      const track = controller.width;
      if (track <= 0) return;
      const width = el.offsetWidth;
      const f0 = controller.fractionOf(block.start);
      const f1 = controller.fractionOf(block.end ?? controller.clock.read());
      if (align === "center") {
        // Centred over the visible part of the block, kept clear of the edges.
        const centre = ((clamp(f0, 0, 1) + clamp(f1, 0, 1)) / 2) * track;
        const left = clamp(centre, Math.min(track / 2, width / 2 + 4), Math.max(track / 2, track - width / 2 - 4));
        el.style.left = `${left}px`;
      } else {
        // Right-aligned to where the block ends (now, for a waiting turn).
        const right = clamp((1 - f1) * track, 0, Math.max(0, track - width));
        el.style.right = `${right}px`;
      }
    };
    follow();
    controller.followers.add(follow);
    return () => {
      controller.followers.delete(follow);
    };
  }, [ref, block, controller, align]);
}

function placementStyle({ rowTop, rowHeight, up }: PlacementProps): React.CSSProperties {
  return { top: up ? rowTop + 6 : rowTop + rowHeight - 6 };
}

const COUNT_KINDS: { key: keyof LaneBlock["counts"]; one: string }[] = [
  { key: "commands", one: "command" },
  { key: "edits", one: "edit" },
  { key: "tools", one: "tool call" },
  { key: "delegations", one: "delegation" },
];

export interface TooltipProps extends PlacementProps {
  id: string;
  now: number;
  detail: DetailState;
  describe: Describe;
  onOpen(split: boolean): void;
}

export function BlockTooltip(props: TooltipProps) {
  const { id, block, now, detail, describe, onOpen, up } = props;
  const ref = useRef<HTMLDivElement>(null);
  usePopoverPlacement(ref, props, "center");
  const lane = describe(block.threadId).title;
  const title = blockTitle(block, describe);
  const counts = COUNT_KINDS.filter((c) => block.counts[c.key] > 0);
  const summary = detail.status === "ready" ? detail.detail.summary : [];
  return (
    <div
      ref={ref}
      id={id}
      className="bl-pop bl-tip"
      role="dialog"
      aria-label={`${lane}: ${title}`}
      data-up={up ? "" : undefined}
      data-status={block.status}
      style={placementStyle(props)}
    >
      <span className="bl-tip-head">
        <span className="bl-tip-lane">{lane}</span>
        <span>·</span>
        <span>{STATUS_LABEL[block.status]}</span>
        <span>·</span>
        <span className="bl-tip-num">{formatDuration(blockDuration(block, now))}</span>
      </span>
      {detail.status === "loading" ? (
        <span className="bl-tip-skeleton" role="status" aria-label="Loading what got done">
          <span />
          <span />
          <span />
        </span>
      ) : summary.length > 0 ? (
        <ul className="bl-tip-list">
          {summary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <span className="bl-tip-title">{title}</span>
      )}
      {detail.status === "error" && <span className="bl-tip-empty">Couldn’t load what happened.</span>}
      {detail.status === "ready" && summary.length === 0 && block.end === null && (
        <span className="bl-tip-empty">No detail yet.</span>
      )}
      {counts.length > 0 && (
        <span className="bl-tip-counts">
          {counts.map((c) => (
            <span key={c.key}>{plural(block.counts[c.key], c.one)}</span>
          ))}
        </span>
      )}
      <span className="bl-tip-actions">
        <button type="button" className="bl-tip-open" onClick={() => onOpen(true)}>
          Open<kbd aria-hidden="true">↵</kbd>
        </button>
        <button type="button" className="bl-tip-open bl-tip-open--quiet" onClick={() => onOpen(false)}>
          Open here<kbd aria-hidden="true">⇧↵</kbd>
        </button>
      </span>
    </div>
  );
}

export interface DecisionProps extends PlacementProps {
  id: string;
  describe: Describe;
  onDecide(decision: "approve" | "reject"): void;
  onOpen(split: boolean): void;
}

export function DecisionPopover(props: DecisionProps) {
  const { id, block, describe, onDecide, onOpen, up } = props;
  const ref = useRef<HTMLDivElement>(null);
  usePopoverPlacement(ref, props, "end");
  const ask = block.ask;
  const inline = ask?.canDecideInline ?? false;
  const title = blockTitle(block, describe);
  return (
    <div
      ref={ref}
      id={id}
      className="bl-pop bl-ask"
      role="dialog"
      aria-label={`Decide: ${title}`}
      data-up={up ? "" : undefined}
      style={placementStyle(props)}
    >
      <span className="bl-ask-title">{title}</span>
      {ask?.prompt && <span className="bl-ask-text">{ask.prompt}</span>}
      <span className="bl-ask-actions">
        <button type="button" className="bl-link" onClick={() => onOpen(true)}>
          Open
        </button>
        {inline ? (
          <>
            <button type="button" className="bl-btn" onClick={() => onDecide("reject")}>
              Reject
            </button>
            <button type="button" className="bl-btn bl-btn--primary" autoFocus onClick={() => onDecide("approve")}>
              Approve
            </button>
          </>
        ) : (
          <button type="button" className="bl-btn bl-btn--primary" autoFocus onClick={() => onOpen(true)}>
            Answer in thread
          </button>
        )}
      </span>
    </div>
  );
}
