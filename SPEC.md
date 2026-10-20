# bb Lanes — spec

Read `AGENTS.md` first: it holds our principles and the fixed opinions that
override anything here.

Lanes is a bb plugin that shows **where every agent is right now** as a live
timeline: one lane per thread, one block per agent turn growing into "now",
hand-off curves drawn between threads, and approvals answered right on the
block. It is a reverse-engineered, bb-native take on affectUI's
[Agent Lanes](https://www.affectui.com/components/agent-lanes) component,
scaled up from a 760px card to a full bb pane, with the sidebar's groupings.

Design and interaction quality are the point of this plugin. A correct but
ordinary timeline is a failure. Every motion, hover, and keyboard path should
feel considered.

## Reference

The reference is affectUI's paid Agent Lanes component
(https://www.affectui.com/components/agent-lanes). Its source is not in this
repository; maintainers with a licence keep a local copy in
`reference/affectui-agent-lanes/` (git-ignored). It is the taste baseline. Borrow freely: structure, variable names, motion, copy
("Needs you", "Idle", "now", "Last 30m"), the tray-and-card shell, the dark
tooltip, the decision popover, the state tag that collapses with
`grid-template-columns: 0fr → 1fr`, the left-edge mask fade, the shimmer, the
flowing dashed hand-off curve, the pulse.

Key reference mechanics worth copying exactly:

- The moving layer: blocks and curves are positioned against a fixed anchor
  time `N` captured on mount (`P(t) = (t - N) / span * 100 + 100` percent),
  and the whole layer is translated by `-(now - N) / span * 100%`. The window
  slides by transform only; blocks are not re-laid-out every tick. Curves
  live in the same layer in an SVG with `viewBox="0 0 1000 rows*48"`,
  `preserveAspectRatio="none"`, and `vector-effect: non-scaling-stroke`.
  When the anchor drifts far (e.g. > 1 span) re-anchor.
- Running/waiting blocks have no end and reach "now"; `min-width: 0` so they
  grow out of the now line from nothing and never poke past it.
- Hand-off curve: `M x1 y1 C x1+s y1, x2-s y2, x2 y2` with
  `s = max(24, |x2-x1|/2)`; dashed `3 3`; a live one (target running)
  animates `stroke-dashoffset` and takes the running colour.
- Popover placement: below the lane in the top half, above it (`data-up`,
  `translateY(-100%)`) in the bottom half. Tooltip centred over the visible
  part of the block, clamped to 14–86%. The decision popover is right-aligned
  to the block's end.
- Pointer-down outside the open block or popover closes it. Esc closes and
  returns focus to the block. The Approve button autofocuses.
- `aria-live="polite"` announcement of "N need you" / "N running".
- `prefers-reduced-motion`: everything still, only updates.

`reference/sample-thread-events.json` holds redacted real
bb thread events showing the shapes the server indexes.

## bb surfaces

Use the bb plugin authoring skill references at
`/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist/builtin-plugins/bb-guide/skills/bb-plugin-authoring/`
(`SKILL.md`, then `references/frontend-core-slots.md`,
`frontend-hooks-and-ui.md`, `frontend-registration.md`, `backend-sdk.md`,
`backend-events.md`, `testing.md`). The SDK declarations in
`node_modules/@get-bb/plugin-sdk/bundled-types/` are the contract. bb's own
source is checked out at `~/repos/get-bb/bb` (read-only reference: the
native sidebar, theme tokens, status colours, and builtin plugins such as
`plugins/github` show house style).

1. **navPanel `lanes`** (`/plugins/<id>/lanes`): the full pane. Owns the body;
   host renders the title bar with our `headerContent` on the right.
   `experimental_sidebarAccessory`: a tiny live count on the sidebar row
   ("3" running, with an amber "1" when someone is needed).
2. **threadPanelAction `team-lanes`** (flush layout): the same timeline scoped
   to the current thread, its descendants, and anyone it handed off to.
3. **CLI `bb lanes`**: `bb lanes now` prints a bounded text table of what
   is running / waiting right now (useful to agents), plus a skill in
   `skills/lanes/SKILL.md`.

## Data

- Thread metadata comes live from `experimental_useSidebarThreads()` on the
  frontend (title, project, section, environment, host, provider, status,
  `hasPendingInteraction`, `parentThreadId`, `updatedAt`, …) and providers
  from `experimental_useProviders()` (name, logo). Thread actions from
  `experimental_useSidebarThreadActions()` (open, open in split, pin, read,
  archive).
- Turn history comes from our server (`shared/model.ts`,
  `shared/rpc.ts`). The server indexes bb thread events into blocks and
  hand-offs, keeps them in plugin SQLite storage, stays live with
  `bb.sdk.subscribe`, and publishes `lanes-changed` signals.
- Event → model mapping (see the sample events):
  - `turn/started` (scope.turnId) opens a block; `turn/completed`
    closes it (`data.status`: completed → done, failed → failed,
    interrupted/cancelled → interrupted).
  - The `client/turn/requested` immediately before a turn gives its input
    (title = first line of `input[0].text`), `source` (spawn / tell / …),
    `initiator`, and `senderThreadId`. `tell` with `senderThreadId` is a
    hand-off from the sender to this block. A child thread's `spawn` turn
    whose thread has `parentThreadId` is a spawn hand-off from the parent.
  - `system/interaction/lifecycle` with `status: "pending"` marks the
    open block `waiting` (with `ask`); `resolving`/`resolved`/`cancelled`
    returns it to running.
  - `item/started` items count tool families: `commandExecution` →
    command, `fileChange` → edit, `toolCall` → tool (Skill → skill, mcp →
    mcp, web search → web), `delegation` → delegation, `agentMessage` →
    messages.
  - A turn still open on a thread whose live status is idle (bb restarted
    mid-turn) is closed as interrupted at the thread's `updatedAt`.

## Experience

### Shell layout (full pane)

```
┌ host title bar: ▦ Lanes ─────────── ● 4 running  ▲ 2 need you  [15m 1h 4h 1d 7d]  ⟳ Live ┐
│ tray                                                                                      │
│ ┌ card ───────────────────────────────────────────────────────────────────────────────┐ │
│ │ Group: Project ▾   All · Active · Needs you · Failed      ⌕ Search  /         ⋯     │ │
│ │                         −25m      −20m      −15m      −10m      −5m          now ▏ │ │
│ │ ▾ bb-lanes  3 · ▲1                                                                  │ │
│ │   ◉ Spec the pane        Opus 5.5   ███▒▒▒ Competitor… ╮                          ▏ │ │
│ │   ├ ◉ Backend indexer    GPT-6.1    ╰──── ████████ Draft index… ░░shimmer░░░░░░▏ │ │
│ │   └ ◉ Timeline engine    Opus 5.5         ▓▓▓▓▓▓▓▓▓▓▓▓▓ Needs you ▲          ▏ │ │
│ │ ▸ chillidonut  12 lanes  ▁▂▅▂▁▃▇ (collapsed: merged activity strip)                │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Tray-and-card from the reference, mapped onto bb theme tokens so custom
  palettes work (no hard-coded greys; derive tints with `color-mix` from
  host variables). Light and dark both first class.
- Sticky time ruler at the top of the card; sticky names column on the left
  (resizable by drag, 168px default, collapses to avatars under 520px);
  "now" pill at the right edge of the ruler with a hairline down the track.
- Group by, like the sidebar: **Project** (default), **Section**,
  **Environment**, **Machine**, **Provider**, **Team** (root coordinators
  with their sub-threads nested), or **None**. Sub-threads nest under their
  parent with tree guides in every mode where parent and child share a
  group. Groups collapse; a collapsed group draws a single merged activity
  strip (union of its lanes' blocks, tinted by the most urgent state) so
  you still see the shape of the work.
- Filters: All · Active (has a block in the window or is busy now) ·
  Needs you · Failed. Default Active. Search (`/`) filters lanes by title,
  project, model; matches highlight.
- Window spans 15m · 1h · 4h · 1d · 7d (keys 1–5). Ticks adapt
  (1m / 5m / 15m / 1h / 6h / 1d); hovering the ruler shows the absolute
  clock time under the pointer.
- Lane header cell: provider logo on a white tile (initials fallback), title
  (one line, ellipsis), subtitle (model · environment/branch, muted), state
  tag (Idle / Needs you / Failed / Queued) that collapses away while running,
  exactly like the reference. Unread threads get a small dot. The thread
  open in another pane is highlighted.
- Preferences (group by, filter, span, collapsed groups, names
  width) persist in `localStorage` keyed by `experimental_usePluginId()`.

### Timeline

- Blocks per the reference: done = quiet fill; running = blue tint +
  shimmer + inset right edge; waiting = amber + pulsing "Needs you" flag at
  the end; failed = red tint; interrupted = done fill with a hatched end.
  Tool glyphs (≤3) before the title. Blocks narrower than ~28px drop the
  label; narrower than 6px still render as a 6px sliver.
- A confirmed user input has a hollow blue dot at the turn's start; a
  confirmed bb input has a hollow red dot. No line accompanies these dots.
  Incoming hand-offs keep their existing marker instead. Uncertain and
  provisional origins stay unmarked. Hover names the origin; the turn's
  popover and accessible label also identify it.
- Tool icons describe work done during the turn. Hovering the group or
  focusing the turn shows one tooltip naming its visible tools.
- Hand-off lines between lanes, one fixed style per kind (`HANDOFF_LINES`
  in `shared/view.ts`; see AGENTS.md "Our opinions"). They leave the
  sender's lane at the moment in the reply, not the block's end. Live ones flow. Hovering a
  block or lane emphasises its hand-offs and the lanes on the other end and
  dims unrelated blocks (opacity, not hiding).
- Pan and zoom: horizontal wheel / trackpad swipe or drag on empty track
  pans back in time and leaves live mode; a "Jump to now" pill appears
  (key `n`). ⌘/Ctrl + wheel and pinch zoom around the pointer, clamped to
  1m … 7d. `[` / `]` pan by a third of the span. Panning back to now resumes
  live. Momentum feels native; no jank (transform-only during gestures).
- Click a block: the dark tooltip (head "Thread · Done · 4m", summary
  bullets lazy-loaded with a skeleton shimmer, tool counts, prompt) with
  **Open** (Enter) follows the saved "Open to the side by default" preference.
  ⌘/Ctrl-Enter or ⌘/Ctrl-click opens using the other destination; the second
  tooltip action names that destination. Double-click follows the default.
- Waiting block: decision popover with the ask. Inline Approve / Reject when
  the server says `canDecideInline`; otherwise "Answer in thread" opening it.
  Optimistic: the block returns to running immediately, rolls back on error
  with a toast.
- Keyboard: Tab moves block to block lane by lane (reference behaviour);
  ←/→ previous/next block in the lane, ↑/↓ same time in the adjacent lane,
  Home/End first/last block, Enter opens tooltip/decision, Esc closes and
  restores focus. Every block is a button with a full aria-label; every lane
  is a labelled list.
- Motion: the window slides continuously with the clock (transform on a
  layer, rAF-driven or 250ms ticks, never re-layout per frame); new blocks
  grow out of now; blocks sliding out the left edge fade through the mask;
  state tags collapse; group collapse animates height; popovers rise 3px in.
  `prefers-reduced-motion` stops everything.
- Empty state: a calm, designed empty card ("No agent activity in the last
  15m") with a button to widen the window and a faint ghost-lane
  illustration drawn with the same block primitives.
- Performance: rows are virtualised (fixed row height 48 / compact 36);
  only blocks intersecting the visible time range plus a margin are
  rendered; 200 lanes × 7d must scroll at 60fps.

## Code layout and ownership

| path | owner | notes |
|---|---|---|
| `shared/model.ts`, `shared/rpc.ts`, `shared/view.ts` | coordinator | contracts. Propose changes to the coordinator; do not silently diverge. |
| `server.ts`, `server/**`, `server.test.ts`, `skills/**` | backend | indexer, storage, RPC, realtime, CLI |
| `app/timeline/**` | timeline | the engine implementing `TimelineProps`, its CSS, fixtures, dev harness |
| `app.tsx`, `app/shell/**` | shell | registration, data hooks, grouping, header cells, toolbar, header content, accessory, team panel |
| `components/ui/**`, `lib/**`, `hooks/**` | shell | vendored shadcn; add with `npx shadcn add @bb/<name>` |
| `reference/**` | — | read only |

## Verification

- `npx tsc --noEmit`, `bb plugin build`, tests with vitest and the SDK
  testing harness (`@get-bb/plugin-sdk/testing`, `/testing/app`).
- Live: `bb plugin install path:<worktree>` is NOT for workers (the
  coordinator owns the installed copy). Workers verify with tests, the
  build, and the timeline's standalone fixture harness.
