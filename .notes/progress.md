# Progress

Append-only, newest at the bottom. One line per completed item: date, linked plan, what actually happened. No shas — `git blame .notes/progress.md` resolves each line to the commit that wrote it.

- 2026-09-05 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): branch cut from main, upstream 0.8.2/0.8.3 triaged into a port plan
- 2026-09-06 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): step 1 unblockers — player state events now publish regardless of Force Max Quality, notifications dedup via a liveMessages Map returning real handles, `ui.js` recolor redraws the overlay
- 2026-09-06 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): step 2 security — launch handling split into src/launch.js and the origin prefix match replaced with a real origin comparison; an intent-less voice launch now searches on its intentParam instead of degrading
- 2026-09-06 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): step 3 adblock engine — parse hook now gated on every setting that needs it, telemetry XHRs resolve empty instead of aborting, emptied shelves dropped, guards reordered cheapest-first
- 2026-09-06 — [upstream-sync-0.8.3](plan-upstream-sync-0.8.3.md): step 4 SponsorBlock — overlay survives a replay from the endscreen, isSkipping only latches on a real seek, observers split into childList and attribute halves
