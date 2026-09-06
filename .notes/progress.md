# Progress

Append-only, newest at the bottom. One line per completed item: date, linked plan, what actually happened. No shas — `git blame .notes/progress.md` resolves each line to the commit that wrote it.

- 2026-09-05 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): branch cut from main, upstream 0.8.2/0.8.3 triaged into a port plan
- 2026-09-06 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): step 1 unblockers — player state events now publish regardless of Force Max Quality, notifications dedup via a liveMessages Map returning real handles, `ui.js` recolor redraws the overlay
