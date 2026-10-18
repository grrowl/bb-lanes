// The ‹ and › at a lane's track edges: a small disc in upstream's pill style
// that opens into "‹ 3h ago" on hover and zips the window to the lane's
// previous or next turn. They sit outside the moving layer, above the left
// fade, and keep their last target while they fade out.
import { memo, useCallback, useRef } from "react";
import type { LaneBlock } from "../../shared/model";
import type { LaneJumps } from "./jumps";
import { jumpDistance } from "./jumps";
import { blockTitle } from "./labels";
import { useUi, type UiStore } from "./store";

type Describe = (threadId: string) => { title: string; subtitle: string | null };
export type JumpSide = "prev" | "next";

export function jumperNavId(side: JumpSide, rowId: string): string {
  return `j:${side}:${rowId}`;
}

/** The side and lane of a jumper's nav id. */
export function splitJumperId(navId: string): [JumpSide, string] {
  const rest = navId.slice(2);
  const colon = rest.indexOf(":");
  return [rest.slice(0, colon) as JumpSide, rest.slice(colon + 1)];
}

export interface LaneJumpersProps {
  rowId: string;
  /** Where the lane's blocks are centred, in canvas px. */
  mid: number;
  jumps: LaneJumps;
  /** Right edge of the window and the clock, for the distance labels. */
  windowEnd: number;
  now: number;
  /** Holds the roving tab stop, which may rest on a jumper. */
  selection: UiStore;
  /** Open the tooltip above the button (the lane is in the lower half of the view). */
  up: boolean;
  describe: Describe;
  onZip(block: LaneBlock, side: JumpSide): void;
}

export const LaneJumpers = memo(function LaneJumpers(props: LaneJumpersProps) {
  const { rowId, selection } = props;
  const roving = useUi(
    selection,
    useCallback((s) => (s.rovingRow === rowId ? s.rovingId : null), [rowId]),
  );
  return (
    <>
      <Jumper {...props} side="prev" block={props.jumps.prev} roving={roving} />
      <Jumper {...props} side="next" block={props.jumps.next} roving={roving} />
    </>
  );
});

function Chevron({ side }: { side: JumpSide }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={side === "prev" ? "M7.5 3 4.5 6l3 3" : "M4.5 3l3 3-3 3"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Jumper({
  side,
  block,
  rowId,
  mid,
  windowEnd,
  now,
  roving,
  up,
  describe,
  onZip,
}: LaneJumpersProps & { side: JumpSide; block: LaneBlock | null; roving: string | null }) {
  // The last target lingers while the button fades out.
  const last = useRef(block);
  if (block) last.current = block;
  const shown = block ?? last.current;
  if (!shown) return null;
  const navId = jumperNavId(side, rowId);
  const title = blockTitle(shown, describe);
  const distance = jumpDistance(shown, side, windowEnd, now);
  return (
    <button
      type="button"
      className="bl-jumper"
      data-side={side}
      data-nav={navId}
      data-show={block ? "" : undefined}
      data-up={up ? "" : undefined}
      tabIndex={block && roving === navId ? 0 : -1}
      aria-hidden={!block}
      aria-label={`Jump to ${side === "prev" ? "previous" : "next"} turn: ${title}, ${distance}`}
      style={{ top: mid }}
      onClick={() => {
        if (block) onZip(block, side);
      }}
    >
      <span className="bl-jumper-face">
        {side === "prev" && <Chevron side="prev" />}
        <span className="bl-jumper-label">
          <span>{distance}</span>
        </span>
        {side === "next" && <Chevron side="next" />}
      </span>
      <span className="bl-jumper-tip" aria-hidden="true">
        <span className="bl-jumper-dot" data-status={shown.status} />
        <span className="bl-jumper-title">{title}</span>
      </span>
    </button>
  );
}
