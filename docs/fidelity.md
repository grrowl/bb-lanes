# Fidelity to upstream

This file records how Lanes compares with the upstream affectUI Agent Lanes
component, what we checked, and where we chose to differ.

## Narrow panes and touch

These checks run against the live bb at 390 by 844 with touch emulation, in
`scripts/qa/mobile.mjs`. The screenshots are in `docs/fidelity/mobile/`.

| Check | Result |
|---|---|
| A rightward touch drag on the track pans back in time | Pass |
| The same drag does not open bb's sidebar | Pass |
| A vertical swipe over the track scrolls the rows | Pass |
| The vertical swipe leaves the window following the clock | Pass |
| A rightward drag that starts over the avatars still opens bb's sidebar | Pass |

### How touch panning and bb's sidebar share the swipe

bb opens its sidebar on a phone when you swipe right from anywhere in the
pane. It skips a swipe that starts inside `[data-no-sidebar-swipe]`. The
track and the ruler carry that attribute, so a swipe over time pans time. The
names column does not carry it, so a swipe that starts over the avatars still
opens the sidebar. The track and the ruler set `touch-action: pan-y`, so the
browser still scrolls the rows when you swipe up or down.

### Labels on a narrow pane

Upstream shrinks the names column to the avatars below 520px. On a phone that
hides every lane name and every group name. We keep upstream's 48px avatar
column and bring the names back in two ways.

- **Group rows run the whole width.** An open group draws nothing in its
  track, so its chevron, its name and its summary run across the row. A
  closed group hides its activity strip on a narrow pane, because the name and
  the summary need the room.
- **Lanes name themselves in a caption.** The caption sits at the left of the
  track, above the blocks. It is 11px with a weight of 500, on one line, and
  it ends with an ellipsis when it is too long. A lane that needs you or has
  failed adds "Needs you" or "Failed" in its state colour, because the state
  tag in the names column is not shown.

A caption does not fit above a block in upstream's 48px row, because the
block fills the row from 10px to 38px. So a narrow lane row is 56px tall. The
row has 6px of space, the 14px caption line, 2px of space, upstream's 28px
block, and 6px of space at the bottom. The block keeps upstream's height, and
hand-off lines meet the middle of the block, not the middle of the row.

The caption uses the text colour (`--bl-text`) rather than the muted colour.
The caption stands in for the lane's name, and the muted colour was too faint
to read at 11px on a phone.
