# AGENTS.md

This file is for every agent and person who works on bb Lanes. Read it before
you change anything. `SPEC.md` describes what we are building. This file
describes how we think while we build it.

## What we are building

bb Lanes is an opinionated swarm manager for bb. It shows every agent thread
as a lane on a live timeline, so you can see at a glance:

- who is working
- who is waiting for you
- who failed
- how work moved between threads

It should just work the first time someone opens it. There is no setup step
and nothing to configure before it is useful.

The look and feel come from the affectUI Agent Lanes component
(https://www.affectui.com/components/agent-lanes). It is a paid component, so
its source is not in this repository. Maintainers with a licence keep a local
copy in `reference/affectui-agent-lanes/`, which git ignores, and can run it
next to ours (see `docs/fidelity.md`). Where upstream has an answer,
we copy it exactly. Where upstream has no answer, we extend it in the same
style, so the new parts look like they were made by the same hand.

## Where the inspiration comes from

We follow the Linear Method (https://linear.app/method/introduction). Each
principle below is followed by what it means for this plugin.

**Build for the people who use it.** The person using Lanes is running a swarm
of agents and wants to know where to look next. Every screen should answer
that question. Do not add views that exist to produce reports about the swarm.

**Purpose-built.** Lanes does one job, which is watching and steering a swarm.
We make the decisions so the user does not have to. When you are tempted to add
a setting, choose the best behavior and ship that instead. A setting is a
decision we failed to make.

**Simple first, then powerful.** The first view must be clear with no
explanation. Power comes from keyboard paths, hover detail, and depth that you
find as you use it. It does not come from menus of options.

**Aim for clarity.** Use the names bb already uses: thread, project, section,
machine, turn. Do not invent new terms. Copy is short and literal, e.g.,
"Needs you", "Idle", "now".

**Say no to busy work.** Lanes should never ask the user to maintain it.
Grouping, ordering, and filtering are automatic and sensible by default.

**Decide and move on.** When two options are close, pick one, write down why in
the commit message, and keep going. A good decision now is better than a
perfect decision later.

**Create momentum.** Ship in small, working steps. Every commit should leave
`main` building, type checking, and passing its tests.

**Scope small and show the work.** Prefer small commits and small pull
requests. Show progress with screenshots of the real thing, not with
descriptions of it.

## Our opinions

These are decisions, not defaults. Change one only when the user asks, and
record the change here.

- **Hand-off lines have one fixed style per kind.** Lines leave the sender's
  lane at the moment inside the reply where the hand-off happened. They land
  on the start of the target block. The styles are in `HANDOFF_LINES` in
  `shared/view.ts`:
  - Created (a thread started another) is red, solid, and ends in a filled
    circle.
  - Messaged (one agent told another) is blue, dashed, and ends in an arrow.
  - Ended (a child finished or failed and bb told its parent) is red, solid,
    and ends in an open circle.
  - Forked is neutral, dotted, and ends in an arrow.
  - None of the lines has a start cap.
- **Threads open beside Lanes by default.** The keyboard help includes a saved
  "Open to the side by default" checkbox, shared by all Lanes panes. Click or
  Enter follows that preference on every thread link; ⌘/Ctrl-click or
  ⌘/Ctrl-Enter reverses it.
- **The default view shows active lanes, grouped by project.** Active means
  the thread has a turn in the window or is busy now. Needs you comes first,
  then running, then the most recent activity.
- **Time moves on its own.** The window follows the clock unless you scroll
  back. Scrolling back to now resumes live mode.
- **One density, one look.** Add a size or theme option only after we have
  failed to find one layout that works everywhere.

## Standards

### Design and interaction

- Fidelity to upstream comes first. Match its sizes, spacing, type, colors,
  shadows, and motion timings exactly. Measure them in the browser with
  `getComputedStyle` and do not guess from screenshots.
- Every interactive element needs hover, press, focus, and disabled states,
  and all of them must be visible.
- Every action can be done with the keyboard. Focus is never lost, and Esc
  always returns focus to where it came from.
- Motion only explains a change. It is never decoration. Respect
  `prefers-reduced-motion`.
- Light and dark mode both need to look right. Check both before you report
  that you are done.
- Check your work in real bb with real data before you call it done. The QA
  scripts in `scripts/qa/` take screenshots of the live pane.
- This repository is public. Never commit a screenshot or fixture that shows
  real threads, projects, or messages. Live screenshots go to
  `docs/fidelity/live/`, which git ignores. Use the harness for anything
  committed. Never commit third-party source, including the upstream
  component.

### Robustness

- Lanes must keep working when bb restarts, when a thread is deleted, when the
  connection drops, or when history is large. Treat every value from storage or
  from the network as untrusted until it is parsed.
- A failure in one thread must never stop the others from showing.
- Fast is a feature. Live sliding and panning run at 60 frames per second with
  200 lanes. The window query answers in under 50 milliseconds.

### Code

- The contracts in `shared/` are the boundary between the server, the shell,
  and the timeline. Change them on purpose, keep the change small, and say so
  in your report.
- Write code that reads like the code around it. Use clear names. Comment only
  where the reason is not obvious. Leave no dead code and no TODOs in shipped
  paths.
- Before you report, run `npx tsc --noEmit`, `npx vitest run`, and
  `bb plugin build`. All three must pass.

## How we work

- The coordinator thread owns `main`, the contracts, and the installed copy of
  the plugin. Workers build on their own git worktree branch and report to the
  coordinator with `bb thread tell <coordinator-id> --message-file <file>`.
- Stay inside the paths you own. The ownership table is in `SPEC.md`.
- Commit in small, logical steps. Each commit message explains why the change
  was made.
- Do not push to a remote, install the plugin, or spawn threads unless the
  coordinator asks you to.
- When you are unsure, make the decision that best fits this file, write down
  why, and keep going. Ask only when the question is about what the user
  wants and you cannot answer it from this file or from `SPEC.md`.
