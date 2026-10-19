# Fidelity to upstream

This file records how Lanes compares with the upstream affectUI Agent Lanes
component, what we checked, and where we chose to differ.

## How to check

The upstream component is a paid affectUI component, so its source is not in
this repository. Maintainers with a licence keep a local copy at
`reference/affectui-agent-lanes/`, which git ignores. The parity and
interaction scripts need that copy. The rest run without it.

Screenshots of the live bb show real thread data, so the scripts that take
them write into `docs/fidelity/live/`, which git also ignores. Only
screenshots of the harness, which draws made-up threads, and of the parity
page are committed.

Run both pages, then run the QA scripts. The scripts drive the installed
Chrome through `playwright-core`, which is not a dependency of the plugin, so
point `PLAYWRIGHT_DIR` at any folder where it is installed.

```sh
npx vite --config reference/affectui-agent-lanes/live/vite.config.mjs   # upstream on :5181
npx vite --config app/timeline/harness/vite.config.ts                   # ours on :5199
export PLAYWRIGHT_DIR=/tmp/lanes-qa-tools                               # npm i playwright-core there
node scripts/qa/measure.mjs light        # element by element style and box diff
node scripts/qa/parity.mjs docs/fidelity # side by side screenshots
node scripts/qa/interactions.mjs /tmp/lanes-interactions   # the checklist below, with frame sheets
node scripts/qa/tour.mjs                  # the live bb, needs the plugin installed
node scripts/qa/mobile.mjs
```

The harness draws upstream's demo with `?parity`. It uses upstream's four
agents and seven tasks, its 760px card and its frozen clock. It renders our
engine and the shell's real header cells, tray and bar. `?parity=live` runs
upstream's accelerated script, so the two pages can be compared while blocks
finish, decisions resolve and tags collapse.

## Visual parity

The screenshots put upstream on the left and ours on the right, at a device
scale factor of 2.

| View | Light | Dark |
|---|---|---|
| Static | [light](fidelity/parity-static-light.png) | [dark](fidelity/parity-static-dark.png) |
| Tooltip open | [light](fidelity/parity-tooltip-light.png) | [dark](fidelity/parity-tooltip-dark.png) |
| Decision open | [light](fidelity/parity-decision-light.png) | [dark](fidelity/parity-decision-dark.png) |
| Hand-off curve | [light](fidelity/parity-handoff-light.png) | [dark](fidelity/parity-handoff-dark.png) |

`scripts/qa/measure.mjs` compares about thirty pairs of elements in the two
pages. It reads their boxes with `getBoundingClientRect` and their font,
colour, padding, radius, shadow, animation and transition with
`getComputedStyle`. In both themes these match exactly:

- the tray, the bar, the card, the spark and the title
- the summary and its dots
- the tick labels and the grid lines
- the agent cell, the avatar, the name, the model line and the state tag
- every block state (done, running, waiting, failed), the label and the tools
- the waiting flag's box, the now pill, and the curve's stroke

What still differs is listed under "Deliberate differences". The rest is
below half a pixel, e.g., the harness page centres its tray at x = 170.42
where upstream's sits at x = 170.

## Interaction parity

`scripts/qa/interactions.mjs` drives both pages through the same steps and
prints a result per page. It slows CSS animations with CDP's
`Animation.setPlaybackRate`, so each frame of a sequence lands at a known
animation time. Every check passes on both pages. "Same" means the two pages
behave the same. "Differs" means both pass but a detail differs, and the
note says why.

| # | Check | Upstream | Ours | Same? |
|---|---|---|---|---|
| 1 | Hover fill: a done block goes from `#f2f2f3` to `#ececec` | Pass | Pass | Same |
| 2 | Click opens the tooltip, a second click closes it | Pass | Pass | Same |
| 3 | A pointer down outside closes the popover | Pass | Pass | Same |
| 4 | Esc closes the popover and returns focus to the block | Pass | Pass | Same |
| 5 | Tab moves block to block, lane by lane | Pass | Pass | Differs |
| 6 | Enter opens the tooltip, or the decision on a waiting block | Pass | Pass | Same |
| 7 | Approve has focus when the decision opens | Pass | Pass | Same |
| 8 | Approve turns the block running, Reject turns it failed | Pass | Pass | Differs |
| 9 | Popovers open above lanes in the bottom half (`data-up`) | Pass | Pass | Differs |
| 10 | The tooltip's centre is clamped to 14% and 86% of the track | Pass | Pass | Same |
| 11 | Live sliding speed and the 40px fade at the left edge | Pass | Pass | Same |
| 12 | Shimmer, pulse and flow timings | Pass | Pass | Differs |
| 13 | The state tag collapses and expands | Pass | Pass | Same |
| 14 | Reduced motion stops every animation and transition | Pass | Pass | Same |
| 15 | Below 520px the names column shrinks to the avatars | Pass | Pass | Differs |
| 16 | A live hand-off curve flows | Pass | Pass | Same |

Notes on the details that differ:

- **5. Tab order.** Both visit the drawn blocks in lane order. Upstream also
  tabs to "Review pricing copy", a block that has not started and so has no
  width, and focusing it scrolls upstream's clip 229px sideways. Ours skips
  blocks that are not drawn. After the last block, ours moves on to the names
  column's resize handle.
- **8. Approve and Reject.** The colour change is the same, sampled every
  50ms. Our block also has a 160ms opacity transition, which hover linking
  uses to dim unrelated blocks.
- **9. Popover size.** Our tooltip is 23px taller because of its "Open" and
  "Open here" row. Its placement, its edges and its centre match upstream's
  to under 0.1px.
- **12. Shimmer.** Upstream moves the gradient with `background-position`
  from -100% to 200%. Ours moves a highlight half the block wide with
  `translateX` from -100% to 200%. Both sweep from -50% to 100% of the block
  over 2200ms with the same easing, but ours runs on the compositor, so 200
  shimmering lanes do not repaint the hand-off lines. The pulse (1600ms), the
  flow (900ms) and their easing are the same.
- **15. Narrow.** Ours also shows the lane captions described below.

Measured values:

- Live sliding runs at 9.474 px/s upstream and 9.475 px/s ours. The value
  expected from the track width, the span and the 30x clock is 9.467 px/s.
- The live curve's dashes move at 6.67 px/s on both.
- The tooltip clamps to 0.14 for a block whose visible centre was at 0.08,
  and to 0.86 for one at 0.955.
- The state tag's collapse matches frame by frame to within 1px.

Frame sequences, upstream on the left and ours on the right:

- [Approve](fidelity/interactions/approve-frames.png) and
  [Reject](fidelity/interactions/reject-frames.png), every 50ms
- [The Ops state tag collapsing](fidelity/interactions/state-tag-frames.png)
  when its turn is approved, every 50ms
- [The live curve flowing](fidelity/interactions/curve-flow-frames.png),
  every 100ms
- [The narrow container](fidelity/interactions/narrow-500.png) at 500px

## Deliberate differences

Each of these is a choice. They follow from `AGENTS.md`, from `SPEC.md`, or
from bb's real data, which is larger and messier than upstream's demo.

- **Hand-off lines.** Upstream draws one dashed curve from the end of one
  task to the start of the next. Our lines leave the sender's lane at the
  moment inside the reply where the hand-off happened, and each kind has one
  fixed style from `HANDOFF_LINES`. Created is red and solid and ends in a
  filled dot. Messaged is blue and dashed and ends in an arrow. Ended is red
  and solid and ends in an open ring. Forked is neutral and dotted and ends
  in an arrow. The curve itself is upstream's cubic,
  `M x1 y1 C x1+s y1, x2-s y2, x2 y2` with `s = max(24, |dx| / 2)`. A live
  line flows as upstream's does, and a live solid line breaks into long
  dashes so that it can flow too.
- **Lines that land mid-turn.** A child that finishes can report into its
  parent's turn while that turn is running. That line lands at the moment of
  the report, on the top or bottom edge of the parent's block, so its cap
  never covers the block's title.
- **Tool glyphs.** Upstream shows app logos. We show bb's own tool family
  icons (commands, edits, tools, web, MCP, skills), because that is what bb
  records about a turn.
- **Tooltip.** Upstream's tooltip has an Open link only when it is given an
  `onOpen` handler, and its demo has none. Ours always ends with "Open" and
  "Open here", because opening a thread beside Lanes is a fixed opinion. It
  also lists the turn's tool counts. Its summary loads lazily behind a
  shimmer, shows `code` as code, and keeps each point to three lines,
  because real summaries are longer than upstream's.
- **Decision card.** Ours adds an "Open" link that opens the thread. When bb
  cannot answer inline, the card shows "Answer in thread" instead of Approve
  and Reject.
- **Window pill.** Ours is a menu, so it has a small chevron. It lists the
  spans and Jump to now. When you pan back, it names the stretch of time on
  screen, by clock time, in the running colour.
- **Settled blocks.** Back to back turns keep a 2px gap, so two turns read as
  two turns. Each block also sits on an opaque card, so hand-off lines pass
  under blocks rather than through their titles.
- **Waiting flag.** Upstream pulses the whole flag, so the title under it
  shows through at the low point of the pulse. Ours pulses only the flag's
  mark and words.
- **Now hairline.** `SPEC.md` asks for a hairline down the track under the
  now pill. Upstream has the pill only.
- **Hover linking.** Hovering a block, a lane or a line lights its hand-offs
  and the lanes on the other end, and dims unrelated blocks.
- **The bar in bb.** bb's title bar already says "Lanes", so the tray's bar
  drops upstream's spark and title. On the full pane the summary moves to
  the title bar, so the counts appear once. The tray's bar carries Group, the
  filters, search and the window pill. The team panel has no title bar, so
  its bar leads with the team's own summary.
- **Names column.** Upstream's 168px suits its 760px card. In bb the column
  is 120px plus 18% of the pane, from 168px to 320px, because real thread
  titles are long. The parity page keeps 168px.
- **State tags.** A tag never shows cut off. A quiet tag (Idle, Queued)
  shows only beside a title that fits whole. An urgent tag (Needs you,
  Failed) always shows whole and the title shortens instead, unless the cell
  is too narrow for a readable title. Unread moves to a dot on the avatar.
- **Palette.** Neutrals come from bb's `--canvas`, so a tinted bb theme
  tints the whole pane. Each colour is mixed so that it equals upstream's
  value on bb's default theme, and outside bb it falls back to upstream's
  literal value. Upstream's state colours stay as they are. Light and dark
  follow bb's own `.dark` class on `<html>`, not the system setting.

## Extensions in upstream's language

These parts do not exist upstream. They use its tokens, type scale, radii and
motion.

- **Group rows** are one line, 32px tall, with a chevron, the group's icon,
  its name at 12px and weight 600, and upstream's summary. A summary part
  that does not fit whole is dropped rather than cut.
- **Tree guides** are hairlines from a parent's avatar down to its children,
  with a 5px rounded elbow.
- **The collapsed group strip** is a silhouette of how many lanes were busy,
  in quieter tints than the blocks it stands for.
- **Clusters** draw short turns that sit too close to tell apart as one
  block, with each turn marked where it ran and a count on a flag like chip.
- **Pan and zoom.** A horizontal wheel or a drag pans, and Cmd or Ctrl with
  the wheel zooms. The Jump to now pill is upstream's window pill, floating.
  The scrub track behaves like an overlay scrollbar. It shows while the
  pointer is over the lanes, while you scrub or pan, and whenever the window
  is not following the clock.
- **The names column resize handle** shows a rail hairline on hover and on
  focus, and it moves with the arrow keys.
- **The toolbar** is a row of pills on the tray. The chosen filter and an
  open menu are raised like upstream's window pill. Search is a pill shaped
  field with a `/` hint.
- **Menus** use upstream's decision card look: the card colour, a 12px
  radius, and upstream's popover shadow.
- **The empty state** is a card over ghost lanes drawn with the block
  primitives, with forward hand-offs in upstream's curve. Loading shows the
  ghosts alone, shimmering like a running block.
- **Scroll edges.** When rows scroll under the sticky ruler, the ruler gets
  a lane separator's hairline.
- **States.** Every control has hover, press and focus states. Focus uses
  upstream's 2px focus ring.

## Real bb

`scripts/qa/tour.mjs` takes screenshots of the live bb at 1440 by 900, with
real data, into `docs/fidelity/live/bb/`. They are not committed because they
show real threads. The tour covers the pane at 15 minutes and at an hour, the
tooltip, line hover, a pan, a zoom, the group and window menus, and the team
panel, in light and dark. It switches to the last hour after its first
screenshot, because a quiet 15 minutes shows little.

No thread was waiting on a person during the tour, so the decision card was
checked in the parity page only. bb draws the sidebar accessory in a slot
that its icon navigation hides, so the accessory renders but does not show
in these screenshots.

## Lane jumpers

Upstream has no jumpers, so they are drawn in its language. A jumper is a
22px disc on the card colour with upstream's shadow and a 12px chevron in the
muted colour. It sits 8px inside the track's edge, centred on the lane's
blocks, above the left fade. Its hit area is 32px, and 44px on touch.

- **When they show.** The ‹ shows when none of the lane's turns overlaps the
  left half of the window and the lane has a turn that ended before the
  window. The › shows when the window is not live, none of the lane's turns
  overlaps the right half, and the lane has a turn that starts after the
  window. A jumper therefore never covers one of its lane's turns. While the
  view moves, the jumpers fade out, so a sliding block never passes under
  one.
- **Hover.** The disc opens into a pill, e.g., "‹ 3h ago" or "in 40m ›". It
  opens with the grid technique and the timings of upstream's state tag
  (320ms, with the opacity 260ms after an 80ms delay). A previous turn is
  measured from now. A next turn is measured from the window's right edge.
  The dark tooltip names the turn, with a dot in its state colour.
- **The zip.** The window keeps its span and glides 420ms with a
  decelerating ease (a quartic ease out). The ruler, the blocks and the lines
  move together. A previous turn lands with its end 70% across the window. A
  turn too long for that to show its start lands with its start 10% across
  instead. A next turn lands with its start 30% across, or 10% across when
  it is longer than the span. A window that reaches now follows the clock
  again.
- **Landing.** The turn takes the open block's tone, and a focus ring fades
  around it over 1.2s. Keyboard focus moves to it. A turn older than the
  loaded history is drawn from the server's neighbours, so it is on screen
  during the glide and lands at once. The shell then loads the history
  around it.
- **Keyboard.** The jumpers are in the roving tab order with the blocks. ←
  and → zip when the next target that way lies wholly outside the window,
  e.g., ← on the first turn in view. Enter and Space zip from a focused
  jumper. Its label reads, e.g., "Jump to previous turn: Plan the release,
  55m ago".

`scripts/qa/jumps.mjs` checks and photographs the jumpers in the live bb with
real data, in light and dark, on a desktop and on a 390px touch screen. It
also records a zip with Chrome's screencast and samples every animation
frame. In every run the ruler had the same transform as the lanes on every
frame, and the glide moved on 24 to 27 frames with none over 20ms.

The live screenshots go to `docs/fidelity/live/jumps/`. The committed frame
sheet is from the harness: [a zip to a turn not yet loaded](fidelity/jumps/harness-zip-frames-light.png).

## Narrow panes and touch

These checks run against the live bb at 390 by 844 with touch emulation, in
`scripts/qa/mobile.mjs`. The screenshots go to `docs/fidelity/live/mobile/`.

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

## Interaction audit

`scripts/qa/audit.mjs` previews the checkout's built frontend inside real bb
without changing the installed plugin. It checks the window menu's shortcut
column and selection state, keys while the menu is open, filter navigation,
search focus restoration, turn detail, the narrow View menu, and a failed
history request. It samples narrow row reordering on animation frames to
check that captions move with their lanes. Light, dark and narrow screenshots
and the JSON results go to `docs/fidelity/live/audit/` (ignored by git).

Run `bb plugin build` first, then
`PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/audit.mjs`.
The SDK tests additionally check approval rollback, reconnect notifications,
history retry, and racing detail requests without answering real approvals.
