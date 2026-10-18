---
name: lanes
description: See which bb agents are running and which turns need a person's answer.
---

Run `bb lanes now` for a bounded table of active turns: thread title, project,
elapsed time, and the prompt being worked on. The count above it shows how many
turns need a person. `bb lanes now --json` returns `threads` (at most 50),
`total`, `needsYou`, `indexing`, and `generatedAt` in epoch milliseconds.

History is indexed in the background; `indexing: true` means more lanes may
still arrive. The Lanes pane shows the live timeline and lets a person approve
or reject supported approvals. Other questions must be answered in the thread.
Run `bb lanes` to see help.
