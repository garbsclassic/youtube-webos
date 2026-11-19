# Upstream sync: rebuild on 0.8.5

Branch: `claude/project-thread-guo2ml` on GitHub (cloud sessions can only push there), renamed `feat/upstream-sync-0.8.5` when it lands · Started: 2026-11-19

## Contents

- [Goal](#goal)
- [Divergence](#divergence)
- [Scope](#scope)
- [Verdicts](#verdicts)
- [What does not apply](#what-does-not-apply)
- [Decisions](#decisions)
- [Landmines](#landmines)
- [Steps](#steps)
- [Verification](#verification)
- [Open questions](#open-questions)

## Goal

The fork sits on upstream 0.8.5's module layout, with the fork's divergence re-applied as its own commits, so later syncs are cherry-picks of upstream's per-change commits instead of hand-translated diffs. Users get everything 0.8.5 shipped (playback speed, Load Rows Ahead, the Smooth thumbnail strategy, the settings rework, its bug fixes) minus the features the fork drops, plus the fork's fixes that upstream does not have. It ships as fork 0.3.0, folding in the unreleased 0.3.0 changelog.

## Divergence

- Upstream base: `78a374a` (0.8.4, `synced_to` in [fork-context.json](fork-context.json)). Target: tag `0.8.5` (`e6840cc`, 2026-11-13).
- Fork tip: `main` at `6533754`.
- Upstream history is now real per-change commits (`2c4af3c` playback speed, `d03a589` DeArrow, …) on top of a squashed modularization based on mirijanristic's fork.
- `src/` went from 45 flat files to about 190 modules under `src/core/`, `src/features/<name>/` and `src/ui/`. Diff `78a374a..0.8.5` is about 21k insertions and 15k deletions in `src/` alone; every path in the fork's diffstat is deleted or renamed at the tag, which is why this is a rebuild, not a port.
- Line endings: 0.8.4 was CRLF, 0.8.5 is LF again. Diff across the range with `--ignore-cr-at-eol -w`.
- Tests: upstream has a `.cjs` harness (`tests/run-all.mjs`, unit, behaviour, smoke, bench) with a Chrome 38 environment shim for the legacy build.
- Upstream now documents itself: `AGENTS.md` (0.8.6-b1), `docs/ARCHITECTURE.md`, `docs/CODEMAP.md` plus generated `docs/codemap/`, `docs/DEPENDENCIES.md`.

## Scope

In:

- Rebuilding on 0.8.5 with the fork's identity, tooling and release pipeline.
- Removing the legacy webOS 3–6 build, DeArrow and Return YouTube Dislike.
- Re-applying fork fixes that 0.8.5 lacks, each re-verified against 0.8.5 first.

Out:

- 0.8.6-b1 and later. They become the first cherry-pick sync once this lands.
- New features beyond what 0.8.5 ships.

## Verdicts

The rebuild inverts triage: each row is a fork change, judged against 0.8.5. RE-CHECK means upstream rewrote the area, so the bug the fork fixed must be reproduced against 0.8.5 before anything is ported. A row that doesn't reproduce becomes ALREADY PRESENT.

### Identity, build and tooling

| Fork change | Verdict | Notes |
| --- | --- | --- |
| Dropped legacy webOS 3–6 / Chrome 38 / ES5 build, polyfills, babel legacy targets | APPLIES | Re-drop on 0.8.5: the second webpack build, `src/polyfills/`, every `*-absent.js` stub, `src/features/emoji-font/` (legacy-only, aliased away from the modern build), `hooks/buffer-limit.js` if legacy-only, `tests/harness/chrome38-env.cjs` and `polyfill-conformance-test`, the `build-local*.cmd` scripts, the legacy `.ipk` in workflows. |
| Twemoji emoji-fix deleted | APPLIES | Covered by the legacy drop above; `emoji-wrap.js` and the twemoji CDN go with it. |
| Own README, `repo.json`, version numbering, CHANGELOG | APPLIES | Fork 0.3.0, folding the unreleased 0.3.0 entry. |
| `release.yml` tag guard, `update-repo.yml` dispatch, `dist/` packaging | APPLIES | See [release.md](release.md). Upstream's workflows (auto-discussion, test builds) are N/A. |
| pnpm, dependency bumps (`6533754`) | CONFLICTS | Upstream uses npm. Fork keeps pnpm; take upstream's dependency set, then bump. See Decisions. |
| Prettier removed | CONFLICTS | Upstream wins: keep Prettier. See Decisions. |
| `node:test` suite and CI | N/A | Per decision: adopt upstream's `.cjs` harness. Fork tests are re-written as `.cjs` only for rows below that land. |
| Bundles icons, logos, fonts locally | RE-CHECK | 0.8.5's only remote asset in the modern build is YouTube's own premium wordmark in `features/logo-style.css`, which the 0.8.3 plan already accepted. Confirm nothing else after the legacy drop. |
| `config.ts`: typed, throws on unknown keys, 200 ms debounced write flushed on `pagehide` | ALREADY PRESENT | `core/config.js` has `assertKey` throwing on unknown keys, the 200 ms debounce and a `pagehide` flush. The fork's TypeScript key typing is lost; `tsconfig.json` type-checks JS. |
| `Object.hasOwn` avoided (Chrome 87 target) | ALREADY PRESENT | No `Object.hasOwn` in 0.8.5 `src/`. |
| `tools/profile-resource.mjs`, `.local` CDP scripts | APPLIES | Keep. Re-point any globals they read at 0.8.5's names. |

### Features dropped by decision

| Fork change | Verdict | Notes |
| --- | --- | --- |
| DeArrow (0.8.5) | APPLIES (removal) | `src/features/dearrow/`, `src/vendor/dearrow/`, its settings tab, config keys, logo, tests. |
| Return YouTube Dislike | APPLIES (removal) | `src/features/return-dislike/`, its config, settings rows and tests. `core/per-video.js` stays for SponsorBlock. |
| RYD lifecycle and fetch-validation work (`937abde`), description clipping (`d5b4b67`), RYD header shift (0.8.4) | N/A | Gone with RYD. `comments-fix` stays: #188 is a YouTube bug, not an RYD one. |

### Fork fixes against 0.8.5

| Fork change | Verdict | Notes |
| --- | --- | --- |
| `comments-fix` overrides only the collapsed properties, split selector lists (0.8.4 review) | CONFLICTS | 0.8.5 still emits one all-properties override (`display`, `height`, `width`, `max-height`, `visibility`). Fork wins for the 0.8.4 plan's reasons: merged minified bodies can pin `.zylon-hidden` and others laid out. The narrowed override was never re-verified on hardware; do it here. |
| SponsorBlock chapter-aware markers (`6533754`) | APPLIES | 0.8.5's `features/sponsorblock/bar.js` has no chapter-width mapping, so markers drift on chaptered videos. Port `chapterBarRanges` into `overlay.js`. |
| Yellow bindable: key handler on window capture (0.8.3) | RE-CHECK | 0.8.5's `ui/shortcuts/router.js` listens on `document` capture. The fork found YouTube stops propagation before that sees a trusted yellow. Likely still live. |
| Empty SponsorBlock overlay kept, to avoid a recalc per chrome mutation (0.8.4 review) | ALREADY PRESENT | 0.8.5 `acquireProgressBar` stops searching once a bar is tracked, overlay or not. Confirm with a full-label-only video. |
| `exclusive_access` in the SponsorBlock fetch | ALREADY PRESENT | `features/sponsorblock/constants.js`. |
| Launch origin check, voice launch without `intentParam` | ALREADY PRESENT | `core/launch.js` `sameOriginURL` and the `intentParam != null` guard. |
| `app_api` debug flag, poll backoff and timeout | N/A | `app_api/` is gone; command hooks are `hooks/resolve-command.ts`. |
| Back button #159 (`isAtTopLevel` guard), options-panel `ReferenceError`, shortcut debounce | RE-CHECK | Rewritten in `ui/shortcuts/`. Reproduce each. |
| OLED keep-alive rewrite, blackout above clock and SponsorBlock layers, Back dismisses it (0.8.3) | RE-CHECK | 0.8.5 rewrote `ui/shortcuts/oled.js` and removed the toast; layering and Back behavior unknown. |
| Own `spatial-navigation.js`, scoped settings navigation and deferred pages (`3279778`, trim `f2d329d`) | RE-CHECK | 0.8.5 removed both polyfills; `ui/panel/keyboard.js` and `pages.js` do their own. Check the [resource plan](plan-resource-usage.md)'s panel invariants: both columns, disabled controls, tab wrap-around, Back, overflow scrolling, the panel owning its scroll events. |
| Panel 54vw so every two-column label fits | RE-CHECK | New panel layout; measure on the TV. |
| Lifecycle ownership: session guards in video-quality, screensaver, watch (`937abde`) | RE-CHECK | 0.8.5 has `core/per-video.js`, `core/disposables.js` and split video-quality modules. Port only stale-callback fixes that reproduce (navigating away mid-upgrade, video element replaced). |
| SponsorBlock layout and polling reductions (`9116045`) | RE-CHECK | 0.8.5 rewrote the bar and overlay; it claims no player hook without segments. Profile before porting. |
| Thumbnail traversal bounds, probe lifetimes, visible-first probes (`b83143d`, `4773d51`, trim) | RE-CHECK | 0.8.5 split thumbnail-quality into 14 modules, with a navigation pause and a queue fix. Hold to the resource plan's thumbnail invariants. |
| Response lookup not expanding past depth (`6ff531d`) | RE-CHECK | 0.8.5 `features/adblock/search.js` and `core/bounded-search.js`. |
| Playback speed ruled out in `intent.md` | N/A | Reversed by decision; the `intent.md` line goes. |

## What does not apply

- Everything legacy: polyfills, emoji fixes, the Chrome 38 harness, the `chrome38-env` tests, and the legacy-specific perf work in the 0.8.5 changelog (webOS 3 try/catch avoidance, the emoji queue and the `Object.entries` polyfill cost).
- DeArrow and RYD entries throughout the 0.8.5 changelog, including the `per-video.js` sharing comment.
- Upstream's release plumbing: auto-discussion workflow, test-build `.ipk`s, `build-local*.cmd`, upstream `repo.json`.
- 0.8.4's CRLF note.

## Decisions

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Port or rebuild | Rebuild on `0.8.5` | Port into the flat layout | Every fork-touched path is moved at the tag; upstream now commits per change. |
| Base | Tag `0.8.5` | `test` / 0.8.6-b1 | Tagged release; b1 is the first cherry-pick afterwards. |
| Legacy build, DeArrow, RYD | Removed | Kept behind upstream's split | Owner decision. Dropping the legacy build also removes the per-build stubs. |
| Playback speed | Taken | Left out per `intent.md` | Owner decision. Upstream bypasses the decoder with an MSE timeline rescale plus WSOLA audio; experimental and off by default. |
| Test harness | Upstream `.cjs` | `node:test` | Keeps upstream's tests cherry-pickable. |
| Package manager | pnpm | npm | Owner toolchain. Costs one lockfile conflict per sync; `package.json` edits still cherry-pick. |
| Fork history on `main` | Land with `git merge -s ours main` into the rebuild branch, then fast-forward `main` | Force-push `main` to the new branch | Keeps the fork's history reachable and `main` fast-forward only. |
| Formatting | Keep upstream's Prettier | No formatter | Upstream cherry-picks apply without whitespace conflicts. |
| Legacy-only branches in shared modules | Left as upstream wrote them (`isLegacyWebOS()`, `getWebOSVersion() <= 4`, the emoji-wrap calls in the adblock filters, now a no-op module; the Chrome 38 downgrade helpers in the test harness) | Strip them | They never run on webOS 22+, and editing upstream's hot paths would turn every later upstream change there into a conflict. Files, build plumbing and dependencies that existed only for the legacy build are gone. |
| Codemap | Keep `tools/codemap.mjs`, `docs/codemap/` and `codemap:check` | Delete | Per-module map of callers, settings, events and selectors helps agent work; regenerated in the same commit as any module change. |
| Release | One fork 0.3.0 (minor) | Ship 0.3.0 first, then rebuild | Owner decision; 0.3.0 never shipped. |

## Landmines

1. **Config keys from removed features.** `core/config-options.js` lists DeArrow and RYD keys; `assertKey` throws on reads of removed keys. Remove every reader in the same step, and drop the keys from `tests/fixtures/config-0.8.4.json`-style upgrade tests.
2. **`*-absent.js` stand-ins.** The legacy drop removes the alias table. Each module the modern build replaced with a stand-in must become a direct import or be deleted.
3. **Codemap is generated.** `docs/codemap/` and `codemap:check` fail once modules are removed; regenerate in the same step.
4. **`per-video.js` has two clients.** Removing RYD must leave SponsorBlock's bootstrap intact.
5. **The `.local` CDP scripts and `profile-resource.mjs` read old globals** such as `window.__ytaf_thumbnailDiagnostics`. Check each still exists.

## Steps

### 1. Triage

- [x] Fork-only changes since 0.8.4 inventoried against 0.8.5, with verdicts above
- [x] Check: verdicts and decisions reviewed by the owner

### 2. New base (after 1)

- [x] Cut the rebuild branch from tag `0.8.5`
- [x] Carry over the fork's `docs/`, README, `repo.json`, `.gitignore`, release and test workflows; keep upstream's `AGENTS.md`-style docs beside them
- [x] Switch to pnpm and drop `package-lock.json`; husky and lint-staged restored, with Prettier added to the hook
- [x] Check: the CI gate passes on the untouched upstream code (`pnpm test`, all steps, plus `pnpm run build` and `pnpm run package`)

### 3. Drop the legacy build (after 2)

- [x] Single modern webpack build; remove polyfills, stand-ins, emoji-font, `buffer-limit`, the legacy test entries and `build-local*.cmd`; drop `@babel/runtime`, `@babel/plugin-transform-runtime`, `whatwg-fetch` and `@twemoji/api` (landmine 2)
- [x] The tests that only ran on the legacy bundle now run on the webOS 22+ one; the harness defaults to it
- [x] `ARCHITECTURE.md`, `DEPENDENCIES.md` and `bundle-snapshot.mjs` updated, codemap regenerated
- [x] Check: `pnpm test` passes every step; bundle 252,003 bytes (budget 255 KiB), `.ipk` 108,970 bytes

### 4. Drop DeArrow and RYD (after 2)

- [x] Remove both features, their settings, keys, vendor code and tests (landmines 1, 3, 4); the panel loses its DeArrow tab and the RYD row, and the description shortcut no longer pokes RYD
- [x] Stored `enableReturnYouTubeDislike` and DeArrow keys are dropped on load and on the next write (`core/config.js` already does this; `upgrade-from-084-test` now checks it)
- [x] Check: `pnpm test` passes every step; bundle 191,496 bytes, budget lowered from 255 to 200 KiB

### 5. Re-apply fork fixes (after 3 and 4)

One commit per row, in this order. Reproduce on 0.8.5 first; a row that doesn't reproduce is ticked as ALREADY PRESENT with the evidence. New tests are `.cjs` via the `tester` subagent.

- [x] Yellow key on window capture: REPRODUCED on the B4 (trusted 405 never reached document capture, and 0.8.5 has no yellow binding). Router moved to window capture, ignores the mod's own keys, yellow added to `SHORTCUT_KEYS`
- [x] `comments-fix` narrowed override: ported onto upstream's scanner, unit and bundle tests added; still to re-verify on the TV with the #188 repro
- [x] SponsorBlock chapter-aware markers: `chapterBarRanges` in `overlay.js`, keeping upstream's sibling-overlay positioning (the fork's move of the overlay to `body` was not taken); unit and bar tests added; the B4 showed it still linear, because 0.8.5 tracks the `segment` element; the chapter track is now looked up from it; re-check on the B4 matched the predicted pieces to 0.1 px
- [x] Back #159, options-panel error, shortcut debounce: ALREADY PRESENT on the B4 (play/pause guards on `controlsFocused()`, no ReferenceError over many opens, double press fires once)
- [x] OLED layering and Back: overlay wins `elementFromPoint`; Back REPRODUCED (navigated underneath). The router dismisses the overlay on Back/Escape
- [x] Lifecycle ownership fixes that reproduce: none reproduced (no errors switching watch pages)
- [x] Settings panel invariants and width: PASS on the B4 (every row fits in both themes at 800 px, tab and column wrap-around, Back closes)
- [x] Thumbnail and SponsorBlock resource invariants that profiling shows are missing: none (no gray tiles in Original, Fast or Smooth; panel keydown callbacks 3.5-8 ms)
- [x] Shortcut actions (missed in triage): the fork's 10 s and 30 s seeks (`seek_back`, `seek_fwd`, `_ex`) re-added by owner decision; a stored `chapter_skip_next` is renamed to `chapter_skip`
- [x] Response lookup depth: ALREADY PRESENT. `core/bounded-search.js` never enumerates a node at `maxDepth` (`nextDepth > maxDepth` skips the queue), and `findObjects` keeps a first falsy match (`results[needle] === undefined`); `tests/unit/adblock-search-test.cjs` covers both

### 6. Docs and release prep (after 5)

- [x] `intent.md`: remove the playback-speed and description-navigation lines; add lines for anything this sync keeps that looks like a mistake
- [x] `fork-context.json`: `synced_to` = `0.8.5` / `e6840cc`, divergence rewritten for the new layout
- [x] `CHANGELOG.md` 0.3.0 entry: upstream 0.8.2–0.8.5 credit, dropped features, fork fixes
- [x] `plan-resource-usage.md` re-pointed at the new module paths and counters; `tools/profile-resource.mjs` updated for the panel's `ytaf-active` tab class

### 7. Verify and land (after 6)

- [x] Hardware pass on the B4 (Verification below): `.local/resource-results/hw-pass-2026-11-19.md`; the Shorts keep-alive echo fix and the held-Back swallow are verified by tests only
- [x] `reviewer` subagent over `0.8.5..claude/project-thread-guo2ml`: findings fixed in 9f8f2bd and b4ada0e
- [ ] Land on `main` per the history decision; `npm version minor` → 0.3.0 per [release.md](release.md), tag pushed only when asked

## Verification

CI gate after each step: `pnpm lint && pnpm type-check && pnpm test && pnpm build && pnpm package` (adjusted to upstream's script names in step 2).

On the B4 over CDP (see `.local/README.md`), measured rather than eyeballed:

- #188 repro for comments and description with the narrowed override, first open versus reopen.
- SponsorBlock markers on a chaptered video align with segment times; overlay on a full-label-only video; skip prompt and the Blue key.
- Yellow key bound to an action fires on a trusted press.
- Settings panel: every row and label fits in both themes, navigation invariants above, Back closes it.
- OLED overlay above clock and SponsorBlock, Back dismisses without navigating.
- Playback speed at 0.5x, 1.5x and 2x: `currentTime` against wall clock (the `intent.md` measurement), audio pitch, and the 1080p hold above 1.25x.
- Thumbnails in Original, Fast and Smooth: no gray tiles, cache populates.
- Profile with `tools/profile-resource.mjs` against the numbers in the resource plan.

## Open questions

None open. Prettier, the `main` history approach and the codemap were settled on 2026-11-19; see Decisions.
