# Code Review — 2026-08-23

Review scope: full codebase audit following merge `ce1536e` ("Merge branch 'main' into dev"), which
brought upstream's `playPauseLogic` rewrite into dev.

Status markers:

- **[fixed]** — applied on branch `fix/play-pause-menu-regression`
- **[proposed]** — recommended, not yet applied

## Contents

- [1. Regression: pausing opens the on-screen menu](#1-regression-pausing-opens-the-on-screen-menu)
- [2. Other bugs](#2-other-bugs)
- [3. Refactoring and readability](#3-refactoring-and-readability)
- [4. Conventions](#4-conventions)
- [5. Workflow and CI](#5-workflow-and-ci)

## 1. Regression: pausing opens the on-screen menu **[fixed]**

The merge replaced dev's `playPauseLogic` (`src/ui.js`) with the main/upstream variant and dropped
two safety guards dev had around the synthetic BACK dismissal.

Dev before the merge (`450dc26`):

```js
const activeEl = document.activeElement;
if (activeEl) activeEl.blur();

// Only send BACK if we're not at the top level
const isAtTopLevel = !activeEl || activeEl === document.body || activeEl.tagName === 'VIDEO';
if (!isAtTopLevel) setTimeout(() => sendKey(REMOTE_KEYS.BACK, activeEl), 600);
```

After the merge (`src/ui.js:1160-1170`):

```js
document.activeElement.blur();
setTimeout(() => {
  const currentControls = document.querySelector('yt-focus-container[idomkey="controls"]');
  if (currentControls?.classList.contains('MFDzfe--focused')) {
    sendKey(REMOTE_KEYS.BACK, document.activeElement); // post-blur focus = body!
  }
}, 250);
```

Why it breaks:

1. YouTube auto-shows and focuses (`MFDzfe--focused`) its transport controls on every pause, so the
   re-check inside the timeout is essentially always true.
2. The `isAtTopLevel` guard was removed. A BACK dispatched while focus sits on `<body>` is a
   top-level BACK: instead of dismissing anything, YouTube's global back handler runs and opens its
   exit/side menu.
3. Target changed from the captured pre-blur element to post-blur focus, and the delay shrank
   600 ms → 250 ms, landing mid-animation during the pause transition.

Fix applied: keep the merged code's improvements (re-checking control visibility at fire time,
targeting live focus) but restore the top-level guard and the 600 ms delay. Do not revert the whole
merge — it also contains good changes (selector caching via `resolveCached()`, bundled logos,
polyfill extraction).

## 2. Other bugs

- **Shorts leak of hidden UI [fixed]** — `ytaf-hide-controls` is added on every page
  (`src/ui.js:1150`) but the cleanup timer sat inside the `if (!isShortsPage())` gate
  (`src/ui.js:1154-1177`). Pausing on Shorts left the class applied indefinitely (hiding parts of
  the Shorts UI until some later non-Shorts pause cleaned up). Fix: hoist the cleanup timer out of
  the Shorts gate; only the BACK-dismissal timers are Shorts-excluded.
- **Dead module** [proposed] — nothing imports `src/yt-fixes.js` (only `yt-fixes.css` does, from
  `userScript.js`). Either re-wire it or delete it; `perf_mon.js` still carries registry entries for
  functions that can never run.
- **SponsorBlock force-play** [proposed] — `src/sponsorblock.js:1251-1256`: after an auto-skip,
  `if (this.video.paused) this.video.play()` un-pauses a video the user deliberately paused.
  Surprising UX; should stay paused after a manual-intent seek.
- **Toast bookkeeping mismatch** [proposed] — `src/ui.js:46` clears the module-level notification
  reference after 1500 ms, but toasts live 3000 ms (`src/notifications.js:30`). Double-tapping
  play/pause stacks duplicate "Paused"/"Playing" toasts instead of updating in place.
- **Hot-path logging** [proposed] — `src/hooks/json-stringify.ts:35`: unconditional `console.info`
  inside the `JSON.stringify` hook fires on every serialized playbackContext. Everything else gates
  logs behind DEBUG; this one should too.
- **Stale launch params** [proposed] — `extractLaunchParams()` caches forever (`src/utils.js:227-239`);
  relaunches that don't arrive with a `webOSRelaunch` detail get cold-launch params.
- **Typo'd warning string** [proposed] — `src/lang-settings-fix.ts:21` contains `mismatch."` with a
  stray quote.

## 3. Refactoring and readability

- **Triplicated YT-internals knowledge** [proposed] — controls-focused detection
  (`yt-focus-container[idomkey="controls"]` + obfuscated class `MFDzfe--focused`) appears at
  `src/ui.js:1143`, `src/ui.js:1166`, and `src/video-quality.js:73`, each with a different hiding
  mechanism. Extract one helper (e.g. `arePlayerControlsFocused()`) next to `REMOTE_KEYS` in utils.
- **perf_mon.js size** [proposed] — ~4.5k lines of dev instrumentation shipped in `src/`, disabled
  only by a commented import (`userScript.js:1`). Move to `tools/` or a separate webpack entry so it
  cannot reach production bundles. It also hardcodes mirrors of other modules' internals
  (`YELLOW_CODES`, registry name strings) that rot silently.
- **Dual spatial-nav polyfills** [proposed] — `spatial-navigation-polyfill.js` (~1788 lines) and
  `spatial-navigation.modern.js` (~960 lines) are kept hand-synced and swapped via webpack alias;
  drift is already visible. Extract the shared core or generate one from the other.
- **Hardcoded fork URL for SB icon** [proposed] — `src/Sponsorblock-UI.js:3` points at a raw GitHub
  URL. The merge just fixed this exact pattern for the three logos by bundling them as imports;
  do the same for `IconSponsorBlocker64px.png`.
- **Silent config write at import time** [proposed] — `src/ui.js:1582-1587` force-rebinds
  green → `config_menu` on every boot if no menu binding exists, silently undoing a user's deliberate
  unbind. Warn once instead of writing.
- **Meaningless listener return values** [proposed] — `eventHandler` returns `true`/`false` as if
  they mattered (`src/ui.js:1345-1403`); listener return values are ignored. Return nothing and rely
  on explicit `preventDefault()`.
- **Global mutable coupling** [proposed] — `playPauseLogic` mutates the router's
  `shortcutDebounceTime` (`src/ui.js:1158`); pass it through or expose a setter instead.
- **Vestigial code** [proposed] — unused `categories`/`actionTypes` locals duplicating module
  constants (`sponsorblock.js:1350`), unused `retryAttempts` config, orphaned fields
  (`return-dislike.js:592`, `:632`).

## 4. Conventions

- **Broken `.prettierrc.js` config [fixed]** — a leftover JSON fragment from another project was
  appended after `export default config;`. At statement position `{` parses as a block, and
  `"semi":` is an invalid string label, so the config module threw on load — meaning
  `npm run prettier-check` failed for _every_ file and prettier never enforced anything (this is how
  the indentation churn in section 1 survived). Fixed by deleting the blob; also folded in
  `printWidth: 100` to match the intended 100-column convention. Note: the import-sort plugin
  options from the blob were dropped because the plugin is not installed.
- **Formatting debt now visible** [proposed] — with prettier working again, 35 files fail the check
  repo-wide (pre-existing). Run a dedicated format-only commit (`prettier --write`) separate from
  any functional changes so diffs stay reviewable.
- **Pre-existing static-analysis failures** [proposed] — eslint reports ~680 errors repo-wide
  (~617 auto-fixable, mostly unused catch bindings); type-check reports 6 errors across
  `custom-event-target.ts`, `hooks/fetch.ts`, `block-webos-cast.ts`, and `webpack.config.js`.
  None block the build today, but see CI gap below.
- **Mixed TS without boundary safety** [proposed] — e.g. `FetchRegistry.addEventListener(type: any,
callback: any)` (`src/hooks/fetch.ts`) defeats its own typed EventTarget wrapper. Type these files
  properly or keep them JS.
- **package.json metadata** [proposed] — `"main": "index.js"` points at a nonexistent file;
  `"repository"` still says `webosbrew/youtube-webos` while `homepage` points at the fork.
- **Indentation churn from merges** — `playPauseLogic` carried 2/6/8/12-space mixes after conflict
  resolution. Run prettier over touched files before committing merge resolutions.

## 5. Workflow and CI

- **CI only triggers on branch `test`** [proposed] — `.github/workflows/test.yml` builds nothing for
  PRs targeting main/dev. Add those branches to `on.push`/`on.pull_request`.
- **Build/release mismatch** [proposed] — `npm run build` produces modern-only bundles, yet
  `update-repo.yml` special-cases `webOS22+` IPK variants and `build` duplicates `build:modern`.
  Decide whether legacy builds still ship; if yes there is no production legacy script at all.
- **Version scheme chaos** [proposed] — dev tags `0.1.x`, main releases `0.8.x`, interleaved through
  history. Pick one line and run `tools/sync-version.cjs` on both branches before release.
