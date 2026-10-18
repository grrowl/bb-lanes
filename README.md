# Lanes for bb

Lanes is a bb plugin that shows where every agent is right now: one lane per
thread, one block per agent turn, lines for hand-offs between threads, and
approvals answered on the block. It is a bb version of affectUI's Agent Lanes
component, grown into a full pane with the sidebar's groupings.

## Surfaces

- **Lanes page** (`/plugins/lanes/lanes`). The full timeline. The title bar
  shows live counts, the window span, and Live or Jump to now. The sidebar row
  shows a small live count.
- **Team lanes** (thread panel, Actions list). The same timeline for one
  thread's team: its tree from the root down, and the threads it handed work
  to or from.
- **`bb lanes now`**. A short table of running and waiting turns. The skill in
  `skills/lanes/SKILL.md` tells agents how to use it.

## Keyboard

| Key | Action |
| --- | --- |
| `1` to `5` | Window span: 15m, 1h, 4h, 1d, 7d |
| `g` | Open Group by |
| `/` | Search lanes; `Esc` clears, then leaves the field |
| `n`, `[`, `]` | Jump to now, pan back, pan forward (timeline) |

Pane keys only work while the pane has focus, and never while you type in a
field.

## Code layout

| Path | What it holds |
| --- | --- |
| `server.ts`, `server/` | Indexer, storage, RPC, realtime signal, CLI |
| `shared/` | Contracts: the lane model, RPC schemas, and the shell to engine seam |
| `app.tsx` | Registration: nav panel, header content, sidebar count, team panel |
| `app/shell/` | Live data, grouping, header cells, toolbar, and title bar chrome |
| `app/timeline/` | The timeline engine: time axis, blocks, curves, popovers, motion |
| `components/ui/` | Vendored bb components (add more with `npx shadcn add @bb/<name>`) |

The shell decides which rows exist and in what order. The engine decides where
everything is drawn. They meet at `TimelineProps` in `shared/view.ts`.

## Data

Thread details come live from bb's sidebar view
(`experimental_useSidebarThreads`). Turn history comes from the plugin server
through the `lanes_window` RPC, and stays current through the `lanes-changed`
realtime signal. The page refetches when the connection comes back, when the
window reaches further back, and once a minute as a safety net. Preferences
(grouping, filter, span, density, collapsed groups, names width) are stored in
`localStorage` under the plugin id and are checked on every read.

## Develop

```
npm install
npx tsc --noEmit
npx vitest run
bb plugin build
```

`bb plugin build` only compiles into `dist/`. Install with
`bb plugin install path:<this folder>` when you want to try it live.
