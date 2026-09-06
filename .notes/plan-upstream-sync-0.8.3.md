# Upstream sync: 0.8.2 → 0.8.3

Branch: `feat/upstream-sync-0.8.3` · Started: 2026-09-05

## Contents

- [Goal](#goal)
- [Divergence](#divergence)
- [Decisions](#decisions)
- [What does not apply](#what-does-not-apply)
- [Landmines](#landmines)
- [Steps](#steps)
  - [1. Unblockers](#1-unblockers)
  - [2. Security](#2-security)
  - [3. Hooks and adblock engine](#3-hooks-and-adblock-engine)
  - [4. SponsorBlock](#4-sponsorblock)
  - [5. Return YouTube Dislike](#5-return-youtube-dislike)
  - [6. Screensaver, watch](#6-screensaver-watch)
  - [7. ui.js cheap wins](#7-uijs-cheap-wins)
  - [8. New features](#8-new-features)
  - [9. Cleanup](#9-cleanup)
- [Config schema changes](#config-schema-changes)
- [Verification](#verification)
- [Open questions](#open-questions)

## Goal

Land every change upstream shipped in 0.8.2 and 0.8.3 that still applies to this fork, and deliberately drop the ones the fork's own divergence killed. Beyond the port, this closes four bugs that are live on `main` today: the launch-URL origin spoof, `ui.js:399` calling a method that does not exist, turning off Ad Blocking silently killing Hide Endcards and Guest-Mode prompts, and turning off Force Max Quality killing the clock and all SponsorBlock state handling. Users get four new settings (Force Video Codec, a tri-state YouTube Logo, Remove Live Videos, and a Fast/Original thumbnail strategy), a much cheaper thumbnail pipeline, and a SponsorBlock overlay that survives replays.

## Divergence

The fork branched at `1eb1567` — upstream's 0.8.1 release point, 2026-07-21 — and has since dropped the entire webOS 3-6 / Chrome 38 / ES5 build, converted `config.js` to a typed `config.ts`, bundled icons and fonts, added a `node:test` suite, and renumbered to `0.2.0`. `main` is 23 commits ahead of the merge base; `upstream` is 9.

Upstream's history is squashed into `0.8.2` / `0.8.3` mega-commits plus a "Prepare 0.8.3 file resync" that deletes and re-adds every file, so **cherry-picking is not viable** — every item below is reconstructed from `git diff 1eb1567 upstream -- <path>`. The one real granular commit is `90f5cc9` (PR #171).

Upstream converted `notifications.js` and `return-dislike.js` to CRLF; diff those with `--ignore-cr-at-eol -w` or they read as total rewrites.

## Decisions

| Decision                     | Chosen                                      | Rejected                           | Why                                                                                                                                                               |
| ---------------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync mechanism               | Feature-by-feature port from diffs          | `git merge` / cherry-pick          | Upstream history is squashed mega-commits over a file resync; a merge is one unresolvable conflict                                                                |
| Scope                        | Everything applicable, incl. new features   | Fixes + perf only                  | Keeps the fork feature-comparable; its value is the cleanup, not a narrower feature set                                                                           |
| `hideLogo` → `logoStyle`     | Rename outright, no migration               | One-time localStorage migration    | Nothing is distributed; unknown stored keys are already ignored and new keys fall back to defaults                                                                |
| `bench/`, `build-local*.cmd` | Skip                                        | Port wholesale                     | The `node:test` suite plus CI covers this ground; `.cjs` harnesses fit neither convention nor CI                                                                  |
| `custom-event-target.ts`     | Keep the fork's version                     | Take upstream's                    | Both fixed the same undeclared-`TypedEvent` bug; upstream's drops the `EventListenerArg` export that `hooks/fetch.ts` imports, and types `currentTarget` non-null |
| `hooks/fetch.ts` typing      | Fork's generics, upstream's `Set` bodies    | Upstream's file wholesale          | Upstream regressed the signatures to `any`; only the listener-tracking bodies are the fix                                                                         |
| `playPauseLogic`             | Fork's structure plus upstream's class name | Upstream's full refactor           | Both solve issue #159; the fork's `isAtTopLevel` guard is equivalent, only the stale CSS class is an actual bug                                                   |
| Lazy settings-page building  | Skip                                        | Port `pageBuilders` / `ensurePage` | Upstream's justification is a 170 ms handler on Chrome 38; ~350 lines of restructuring for a small win on Chrome 87                                               |
| Branch shape                 | One branch, a commit per step               | Two branches (fixes / features)    | Live filtering and thumbnail modes share plumbing with the fixes                                                                                                  |

## What does not apply

- **All legacy-build work.** `src/hooks/buffer-limit.js` (webOS 3/4 only; upstream aliases it to `false` in its own modern target), `polyfills.js`, the `core-js-pure` / `@babel/runtime-corejs3` / `regenerator-runtime` / `babel-plugin-polyfill-*` removals (the fork already dropped all five, plus `whatwg-fetch` and `babel.config.js` itself), the twemoji 16.0.1 pin, the whole emoji path in `adblock.js` (`processEmojiString`, `splitIntoRuns`, `processTextFieldsInPlace`, `CLEAN_TEXT_RE`, the `skipEmoji` argument), legacy spatial-navigation perf, `tools/assert-no-bare-require.cjs`, and `SYNTHETIC_KEY_FLAG` (it exists because Chromium 38 reports `isTrusted === undefined`; the fork's `new KeyboardEvent` makes `isTrusted` reliable).
- **`src/playback-speed.js`.** 575 lines, but its config key, shortcut actions, and `ACTION_SCOPES` entries are all commented out upstream. Unshipped dead code.
- **Already present in the fork:** the 200 ms `localStorage` debounce with `beforeunload`/`pagehide` flush (`config.ts:186-213`); `initGlobalStyles()` static CSS plus class toggles; the options-panel `ReferenceError` and shortcut-debounce fixes (the `optionsPanelVisible` early return already precedes the debounce writes at `ui.js:1610-1620` — there is no upstream diff for this); `app_api` debug gating, poll backoff, and timeout; `lang-settings-fix.ts` top-level-await handling; the rounded-corner button rule (`yt-fixes.css:12`, shipped in 0.8.1); locally bundled logos and SponsorBlock icon; bare `catch` cleanups; the module-tail tracking-block auto-install (done in `ui.js` instead).
- **`README.md`, `repo.json`, `assets/appinfo.json` and `package.json` version bumps.** The fork has its own README, its own `repo.json` pointing at `garbsclassic`, and is deliberately on 0.2.0.
- **`Sponsorblock-UI.js`, `sponsorblock.css`, `sponsorblock-ui.css`, `watch.css`.** Upstream's only change was bundling the icon, already done.
- **Untouched by upstream in this range:** `webos-utils.js`, `yt-fixes.js`, `yt-fixes.css`, `auto-login.css`, `index.html`, `block-webos-cast.ts` — the fork's changes there carry no merge risk.
- **Cosmetic only:** `tools/gen-manifest.cjs` and `tools/sync-version.cjs` are CRLF→LF with zero content change; `createElement` `for...in` → `Object.entries`; quote-style churn; consolidating `ui.js`'s `colorCodeMap` into `utils.js` `REMOTE_KEYS`.

## Landmines

Four things that bite silently if ported naively.

1. **`force-codec.js` installs its own `JSON.parse` wrapper** (`upstream:src/force-codec.js:286-295`) on top of adblock's (`src/adblock.js:828-829`). `destroyAdblock` does `JSON.parse = origParse` (`:839`), restoring the value captured _before_ force-codec wrapped it — so toggling Ad Blocking off silently uninstalls Force Video Codec, and `syncAdblockHook()` (step 3.6) makes that toggle routine. Upstream carries the same latent bug. Fold force-codec's `streamingData` rewrite into adblock's existing hook the way upstream folded in thumbnails, and leave only the `isTypeSupported` / `canPlayType` narrowing in `force-codec.js`.
2. **`handleTimeUpdate` `segmentIdx`.** Upstream deletes the outer `else { findSegmentAtTime() }` and relies on `let segmentIdx = -1`. The fork has `let segmentIdx;` uninitialized — port the deletion without restoring the `-1` and the `=== -1` guard fails, indexing `skipSegments[undefined]`.
3. **`isSkipping` hunk context.** The surrounding lines include the `isLegacyWebOSVer` jumpTarget clamp the fork deleted. Resolve by hand rather than taking the hunk.
4. **`npm run package` output path.** Upstream added `-o dist`. Three things read the `.ipk` from the repo root today: `tools/gen-manifest.cjs` (which hashes `<id>_<version>_all.ipk` by bare filename), the CI artifact upload in `.github/workflows/test.yml`, and the release artifact glob in `release.yml`. Adopting `-o dist` requires updating all three in the same commit.

## Steps

### 1. Unblockers

- [x] `video-quality.js` `handleStateChange()`: dispatch `yt-player-state-change` _before_ the `_shouldForce` early return. With Force Max Quality off, `watch.js`'s clock and all of `sponsorblock.js`'s state handling are dead today; steps 4 and 6 are inert without this. Also collapse the `STATE_UNSTARTED` / `STATE_BUFFERING` cases, simplify `p.isConnected ?? document.contains(p)` to `p.isConnected`, and pass `handleNavigation` directly to the `ytaf-page-update` listener.
- [x] `notifications.js`: replace the `querySelectorAll('.message')` dedup scan with the module-level `liveMessages` Map. `showNotification` returns the existing message's real handle instead of `NOOP_HANDLE`, and `remove` removes `elm` rather than `existing.parentElement`. Fixes both the seek-burst notification text not updating and SponsorBlock's manual-skip notification buildup — `activeManualNotification.remove()` was a silent no-op.
- [x] `ui.js:399`: `window.sponsorblock?.buildOverlay()` → `drawOverlay()`. Live fork bug — recoloring a segment never redraws the overlay.

### 2. Security

- [x] `utils.js` `handleLaunch`: replace `contentTarget.startsWith(ytURL.origin)` (`src/utils.js:255`) with upstream's `sameOriginURL(candidate, expectedOrigin)` — `new URL(candidate).origin === expectedOrigin`, returning `null` on parse failure. Today `https://www.youtube.com.attacker.example/x` passes and is assigned to `window.location.href`. Keep the fork's `try/catch` wrapper (a strict superset of upstream's `params ?? {}`), but take upstream's shape for the voice branch: it still handles an `intentParam`-only `contentTarget`, where the fork's B-5 fix skips the branch entirely unless `intent` is a string. Add a `test/utils.test.js` case for the spoofed origin — the existing 12 tests miss it.
- [x] Split launch handling into `src/launch.js`, with `utils.js` re-exporting so `userScript.js` import sites are unchanged and `src/index.js` imports from `launch.js`. The bootstrap page is a bare redirect that currently drags in all of `utils.js`'s module-level side effects. Drop upstream's `import './polyfills.js'`.

### 3. Hooks and adblock engine

- [x] `hooks/json-stringify.ts` — whole-file replacement (the fork's copy is byte-identical to the merge base). Drops `structuredClone` on every call for in-place `isInlinePlaybackNoAd` mutation restored in a `finally`, an O(1) root-level `playbackContext.contentPlaybackContext` hit, and a bounded BFS (`MAX_DEPTH 6`, `MAX_NODES 2000`) only when the cheap gates hold. Reword upstream's "the previous implementation ran a BFS" comment — it describes an intermediate upstream state.
- [x] `hooks/fetch.ts` — swap `#listenerCounts` for `#listeners: Record<HookedType, Set<…>>` plus an `isHookedType()` guard, so adding a callback twice or removing one never added stops corrupting the fast path. Keep the fork's generic signatures and `FetchTarget = string | URL | Request`.
- [x] `adblock.js` telemetry — widen `BLOCKED_TELEMETRY_PATHS` (`:16-22`): `/pagead/viewthroughconversion` → `/pagead/`, add `/eligibility_check`. Move the XHR block decision from `send()` to `open()` and re-point blocked requests at `data:text/plain,` instead of `setTimeout(() => xhr.abort())`. Behavior change worth noting in the changelog: blocked requests now resolve empty (200) rather than aborting.
- [x] `adblock.js` hook flags — split `isTelemetryHooked` into `isFetchHooked` / `isXHRHooked`, each set at its own success point and cleared in its own `finally`. Fixes two real fork bugs: a throwing fetch `addEventListener` still flips the single flag, and `destroyTrackingBlock` clears it from the XHR block's `finally`.
- [x] `adblock.js` parse-hook perf — reorder the `hookedParse` guard so `!anyFilterEnabled || !text || text.length < 500` short-circuits before `origParse`; drop `RESPONSE_NEEDLE_RE` (`:55`, `:320-324`) for three root-property `=== undefined` checks (deliberately narrows an anywhere-in-payload match to root-only); assign `JSON.parse = hookedParse` directly instead of the forwarding closure (`:828-831`); swap `Object.keys()` for `for...in` in `walkAndProcess` (`:205`) and `findObjects` (`:813`).
- [x] `adblock.js` emptied shelves — in `processSectionListOptimized` (`:623-681`) hoist `horizItems` / `gridItems` and drop the shelf when both are present-but-empty. Kills the ghost `<ytlr-ghost-surface>` skeleton row; fires for Shorts and ad filtering too, independent of Live filtering. Do not take the `skipEmoji` argument bundled into the same hunk.
- [x] `adblock.js` `syncAdblockHook()` — port `parseHookRequired()` plus `syncAdblockHook()` and call them from the `ui.js` listeners (`:33` imports, `:1827-1832`, `:1852`). Fixes a live fork bug: the parse hook is gated on `enableAdBlock` alone, so turning Ad Blocking off silently disables `hideEndcards` and `hideGuestSignInPrompts`. Drop the `cfgEmojiFixEffective` clause.

### 4. SponsorBlock

The fork's delta here is Prettier reformatting and legacy removal only — none of these were independently fixed. Port in order.

- [x] Skip-logic correctness — latch `isSkipping` only when actually seeking forward (`if (jumpTarget > currentTime + 0.05)`); add `_armSkipWatchdog()` / `_clearSkipWatchdog()` (1.5 s), cleared in `seeked` and `destroy()`. See landmine 3.
- [x] `start()` rebinding — add `playing` and `pause` video listeners (`playing` → `resetSegmentTracking()`), guard re-entrancy by removing prior `yt-player-state-change` and `resize` listeners, and bind via `getVideo()` plus `waitForChildAdd(document.body, n => n instanceof HTMLVideoElement, false, null, 10000)` instead of a one-shot `querySelector` that returned silently. Both helpers already exist (`utils.js:124`, `:292`).
- [x] Overlay replay and endscreen repair (largest single port, ~120 lines, 4 new methods) — `_ensureObserverAlive()`, `_scheduleBarRetry()` (250 ms × 40), `_rebindVideo()`; `checkForProgressBar()` validates `progressBar.isConnected` and drops orphaned overlays; `drawOverlay()` bails on a detached bar and reschedules; the ENDED state clears `lastOverlayHash`, `_anchorCache`, and `_lastSyncSig`.
- [x] Anchor and observers — `_getProgressBarAnchor()` always injects as a sibling and validates `container.isConnected` (keep upstream's two chained `closest()` calls; do not collapse into a union selector). Split the single observer into a childList-only subtree `domObserver` plus an `_attrObserver` pinned to the tracked bar, re-targeted in `checkForProgressBar`.
- [x] Perf — `_syncOverlayPosition()` batches reads and skips style writes via a `_lastSyncSig` compare; `drawOverlay()` uses one `style.cssText` write (drop upstream's leftover dead per-property writes above it); module-level `FETCH_CATEGORIES` and `FETCH_ACTION_TYPES`; `executeChainSkip()` breaks once past `chain.endTime`; `buildSkipChain()` builds its `toFixed` description only after the chain validates. Optionally delete `_isNodeConnected()` and `_getClosest()` for native `.isConnected` / `.closest()`.
- [x] `handleTimeUpdate` — restrict the 1.5 s frame-drop tolerance to `auto_skip` segments and delete the outer `else { findSegmentAtTime() }` fallback. See landmine 2. Upstream's replacement block is tab-indented; reformat.

### 5. Return YouTube Dislike

- [x] Extract `resetPanelState()` (currently duplicated between the poll body and `handleFocusIn`).
- [x] Bounded panel poll — immediate `querySelector` first, then a 20-attempt (~10 s) ceiling with a `stopBodyPoll()` helper, re-armed from `handleFocusIn` when the tracked panel dies. Replaces the unbounded 2 Hz poll that ran for the whole video.
- [x] Fix the "0 dislikes" display — `dislikesValue` with `null` meaning unknown (distinct from 0), a `DISLIKE_PLACEHOLDER` em dash, `updateDislikeDisplay()`, cached `dislikeValueElement` and `dislikeFactoidElement`, injection decoupled from the fetch, `FETCH_MAX_RETRIES = 3` backoff, a `dataReady` flag, and `init()` reordered so `observeBodyForPanel()` runs before the await.
- [x] `formatNumber`: `'M'` / `'K'` → `'m'` / `'k'`; `new URL(urlStr, 'http://dummy.com')` → `new URL(urlStr, location.href)`; drop the dead `SELECTORS.mainContainer: 'zylon-provider-6'`; replace `closest()` in `handleFocusIn` with the `closestPanel()` and `closestMenuItem()` walks.

### 6. Screensaver, watch

- [x] `screensaver-fix.js` — gate logging behind `DEBUG` and delete the per-tick `console.log(msg, node)` retaining a strong ref to a possibly-removed node (the Shorts keep-alive leak). Collapse the target pick to `document.activeElement || document.body`, add the early `if (!isPlaying) return`, merge the two `playerCtrlObs` warn-and-disconnect branches, use `getVideo()` in `updateState()`, and delete `requireElement()` after confirming no importer.
- [x] `watch.js` — drop the `focusout` listener in `setupGlobalListeners()` (focusin only).

### 7. ui.js cheap wins

All trivial, none need config changes.

- [x] `playPauseLogic` (`:1345`): `MFDzfe--focused` → `zylon-focus`. Keep the fork's `isAtTopLevel` and 600 ms structure — only the class name is stale.
- [x] `handleShortcutAction` (`:1490-1491`): move the eager `document.querySelector('.html5-video-player')` into the `toggle_subs` case — it runs a full-page search on every keypress today.
- [x] `eventHandler` (`:1584`): move the input/textarea fast-fail above the scope computation.
- [x] Focus-trap fallback (`:885-887`): `Array.from(querySelectorAll(...)).find(offsetParent)` → a single `querySelector`.
- [x] `skipChapter()` (`:900`): collect chapter widths in one pass instead of two.
- [x] `resolveCached()` helper shared by `toggleCommentsLogic` (`:1158`), `toggleDescriptionLogic` (`:1216`), and `saveToPlaylistLogic` (`:1258`), with module-scope `COMMENT_SELECTORS`, `SAVE_SELECTORS`, and `DESCRIPTION_FALLBACK_SELECTOR`; comments becomes one comma-joined `querySelector` instead of two DOM passes.
- [x] `tabBtns[activePage]` instead of `querySelector('.ytaf-tab-btn.active')` (3 sites).
- [x] `config.ts` `configWrite` (`:242-245`): wrap `callback(syntheticEvent)` in try/catch so one throwing listener does not abort the rest.
- [x] `app_api/index.ts` (`:36`): `resolveCommand` iterates `this.#cmds` with `key in command` instead of allocating via `Object.keys(command)` per call.
- [x] PR #171 (`90f5cc9`): delete the `focus` / `blur` → `classList.add/remove('focused')` listeners in `createConfigCheckbox` (`:226-227`), which desynchronize the panel focus state. Land with step 8's CSS, which replaces `.focused` with `:focus-within`.

### 8. New features

Land as one batch — the new rows are what force the CSS relayout.

- [x] `createAlignedCycleControl()` helper (hidden checkbox reserves the label indent) — prerequisite for the three cycle controls below. It only reads `.shortcut-label`, which the fork's `createGenericControlRow()` (`:257`) still emits, so it drops in unchanged.
- [x] Force Video Codec — port `src/force-codec.js`, restructured per landmine 1: keep the `MediaSource.isTypeSupported` and `HTMLMediaElement#canPlayType` narrowing in the module, but move the `streamingData.adaptiveFormats` / `.formats` rewrite into adblock's parse hook. It only ever narrows: a forced codec is never reported supported when the platform denies it, audio is passed through untouched, and an unsatisfiable list is left alone. Import from `userScript.js`. Add `forceVideoCodec` plus a cycle control in the Video Player section.
- [x] YouTube Logo tri-state — port `src/logo-style.js` (90 lines). Swaps YouTube's own wordmark URL _and_ its `left` and `width` (the header positions it from intrinsic width), polling up to 15 s with no observer left running. `hidden` reuses the fork's existing `ytaf-hide-logo` class on `<html>`, so `ui.js:1642-1643`'s CSS stays. Replace the `hideLogo` checkbox (`:738`) with a cycle control and remove the `syncClass('ytaf-hide-logo', 'hideLogo')` wiring (`:1741`, `:1746`) — `logo-style.js` owns the class now. Note the two hardcoded `gstatic.com` PNG URLs: they are YouTube's own assets, not panel assets, so this does not violate the fork's bundle-locally policy, but it is a remote dependency.
- [x] Remove Live Videos (Global) — port `isLiveItem()`, `YT_CONSTANTS.BADGE_STYLE_LIVE`, and the `cfgFlags` / `recomputeFilterFlags` / `anyFilterEnabled` / `filterItemsOptimized` wiring (~60 lines). Searches `lockupViewModel.contentImage.thumbnailViewModel.overlays[]…badges[]` with `tileRenderer` and `TILE_CONTENT_TYPE_LIVE` fallbacks. Add the checkbox to Cosmetic Filtering and to `updateDependencyState`'s ad-block dependency list.
- [x] Nav-tab filtering — port `isNavEntryBlocked()` plus `removeBlockedNavEntries()`, called from `applySchemaFilters`, `applyFallbackFilters`, and a new small-response `hookedParse` branch. Removes the left-nav Shorts tab (for the existing `removeGlobalShorts`) and the Live tab. Matches by endpoint first (`reelWatchEndpoint`, `browseId` of `FEshorts` / `FEshorts_tv` / `FEtopics_live`), then by title. Uses `findObjects(data, […6 needles], 8)`, which `test/adblock.test.js` covers — verify after the `for...in` change.
- [x] Max Thumbnail Quality: Fast / Original — the big one. Whole-file replacement of `src/thumbnail-quality.js` (504 → ~1086 lines). The DOM `MutationObserver` / `IntersectionObserver` / HEAD-probe-queue pipeline is deleted for an InnerTube JSON rewriter driven from adblock's parse hook, exporting `upgradeResponseThumbnails(data, responseType)` and `thumbnailHookRequired()`. Adds search-page support, a localStorage quality cache (`ytaf-thumb-quality`, 1200 entries, debounced, flushed on `visibilitychange` and `pagehide`), and background HEAD verification with a promotion sweep. Nothing the fork added survives, so this is a replacement rather than a merge. Then:
  - Wire `import { upgradeResponseThumbnails, thumbnailHookRequired }` into `adblock.js` and call it _after_ filtering in `hookedParse`; add `cfgFlags.upgradeThumbnails` to `recomputeFilterFlags` and `anyFilterEnabled`.
  - Remove `import './thumbnail-quality.js';` from `src/userScript.js:13` — the module now has no side-effect observers and is imported only from `adblock.js`.
  - Rewrite `from './config.js'` → `from './config'` at both import sites (TS resolution).
  - Import `getByPath` from `adblock.js` (exported and test-covered) rather than keeping upstream's local copy.
  - Check whether `waitForChildAdd` becomes unused repo-wide once the old pipeline goes (step 4's `start()` rebinding adds a new caller, so it likely stays).
  - Add `thumbnailQualityMode` plus a cycle control after `upgradeThumbnails` in the Interface section, grayed out (`opacity 0.5`, `tabIndex -1`) when `upgradeThumbnails` is off.
- [x] Bypass Nag Screens — port `disablePromoUpsell()` into `auto-login.js` (~90 lines, mirroring the existing `disableWhosWatching()` shape at `:20` exactly), handling `yt.leanback.default::promo-coupon-shown-timestamp` and `::promo-coupon-shown-times`. Call from `initAutoLogin()` and the `enableAutoLogin` change listener. Change the key's description to `'Bypass Nag Screens'` — no new key, no new UI row. Drop the now-unused `extractLaunchParams` import (`auto-login.js:2`; its only use at `:92` is already commented out).
- [x] `ui.css` green-button relayout — font 2.22vh → 2.5vh, line-height 0.85 → 0.95, `.focused` rules and `transition: box-shadow` removed in favor of `:focus-within`, `.section-title` and `.ytaf-settings-section` moved out of inline styles, `#ytaf-page-main` density trims, and the two-column Cosmetic Filtering layout. Requires `createSection(title, elements, variant)`. The two-column layout exists only because the Main page gains a row — port it with the new settings or the page risks overflowing 95vh. Upstream used a flexbox hack because Chrome 38 has no CSS Grid; the fork can use Grid. Take `.ytaf-ui-container > div.ytaf-settings-page { overflow-y: auto }` regardless — it is a cheap standalone safety net.

### 9. Cleanup

- [x] Drop the dead `@twemoji/api` dependency — nothing under `src/` imports it since the emoji fix was deleted.
- [x] Delete the unused `EventInstanceType` and `EventOptionsType` from `custom-event-target.ts` (`:13`, `:17`) — the one thing worth taking from upstream's version of that file.
- [x] Optionally adopt `ares-package -n dist -o dist` plus the matching `tools/deploy.js` path, which fits the fork's untracked-`dist/` convention. See landmine 4 — `gen-manifest.cjs` and both workflows need updating in the same commit.
- [ ] Run `npm version patch` on `main` once the changeset is merged and committed, per the `fork-sync` skill — the `v*.*` tag is what drives `release.yml` and, through it, the regenerated `repo.json`.
- [x] Update `CHANGELOG.md` under a new `0.3.0` heading in the fork's Keep-a-Changelog style, crediting upstream 0.8.2 and 0.8.3, and noting the two behavior changes: telemetry requests resolve empty rather than aborting, and `hideLogo` is gone so the logo resets to the default wordmark.

## Config schema changes

All in `src/config.ts`, following the existing `sbModes` / `forcePreviewModes` pattern (an `as const` map, a `keyof typeof` type, then an `opt<T>()` entry). Each enum needs a matching `createAlignedCycleControl(key, label, Object.keys(map), map)` row in `createOptionsPanel()` (`ui.js:463`); `removeLiveVideos` is a `createConfigCheckbox`.

| Key                    | Type / default                                                                                                          | Replaces   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| `logoStyle`            | `logoStyles = { default: 'Default', premium: 'Premium', hidden: 'Hidden' }`, default `'default'`, desc `'YouTube Logo'` | `hideLogo` |
| `thumbnailQualityMode` | `thumbnailQualityModes = { safe: 'Original', eager: 'Fast' }`, default `'safe'`, desc `'Thumbnail Strategy'`            | —          |
| `forceVideoCodec`      | `videoCodecModes = { auto, av1, vp9, avc, hevc, no_av1 }`, default `'auto'`, desc `'Force Video Codec'`                 | —          |
| `removeLiveVideos`     | `boolean`, default `false`, desc `'Remove Live Videos (Global)'`                                                        | —          |

`enableAutoLogin` keeps its key; only its `desc` changes to `'Bypass Nag Screens'`.

## Verification

Run the full CI gate (`.github/workflows/test.yml`) after each numbered step:

```bash
npm run prettier-check && npm run lint && npm run type-check && npm test && npm run build && npm run package
```

- **Existing tests.** `test/adblock.test.js` covers `findObjects`, `getByPath`, and `detectResponseType` — it gates the `for...in` rewrite and the depth-8 nav-entry search. `test/sponsorblock.test.js` covers `buildSkipChain`; the reordered `toFixed` build is byte-identical output, so it must stay green untouched. `test/utils.test.js` has 12 `handleLaunch` cases, none covering the prefix match.
- **New tests**, via the `tester` subagent after each step's implementation: the `handleLaunch` origin-spoof rejection (`https://www.youtube.com.attacker.example/x` must not be navigated to), `isLiveItem`, the emptied-shelf drop in `processSectionListOptimized`, `parseHookRequired()`, and the `hookedParse` short-circuit guard order.
- **Bundle size.** Record `npm run build` output size before starting; the thumbnail rewrite and `force-codec.js` roughly double their modules' line counts, so confirm no material regression.
- **On-device or simulator.** Everything in steps 4, 5, and 8 changes rendered geometry or state and cannot be verified by tests. Build, `npm run package`, deploy to a webOS 22+ target or the webOS TV simulator, then check by hand: the SponsorBlock overlay survives a replay from the endscreen and a mid-video color change; the panel focus highlight tracks the selection after the `.focused` removal; the logo renders aligned in all three modes; Live and Shorts nav tabs disappear when their filters are on; thumbnails upgrade in both Fast and Original with no gray boxes in Original; RYD shows an em dash rather than 0 before data lands; the settings panel does not overflow at 95vh with the new rows. Check both UI themes (`blue-force-field`, `classic-red`) for the CSS work. If the implementing session has no device or simulator, say so and mark these visually unverified — do not report them as working on a green test suite.
- **Regression sweep.** Turn Ad Blocking off: Hide Endcards, Guest-Mode prompt hiding, and Force Video Codec must all still work (landmine 1 plus step 3's `syncAdblockHook`). Turn Force Max Quality off: the clock and SponsorBlock must still update (step 1).
- **Branch review.** Run the `reviewer` subagent over `main..feat/upstream-sync-0.8.3` before reporting done.

### What was actually verified on hardware — 2026-09-06

Deployed to the B4 (webOS 25, 1080p) and measured over CDP rather than eyeballed. `ares-install`
fails on this host with `isDate is not a function` inside its bundled ssh2, so the build was pushed
with `scp` and the renderer restarted by PID; `closeByAppId` does not actually stop it, and until the
renderer is killed the app keeps running the previous userScript.

Confirmed:

- All five new rows present; `enableAutoLogin` reads 'Bypass Nag Screens'.
- Parse-hook gate: with ad block, endcards and thumbnails all off the hook uninstalls, and it
  re-arms from endcards alone or thumbnails alone. Ad block off with endcards on keeps it
  installed — the live bug, fixed.
- With Force Max Quality off, `yt-player-state-change` fired 3x across a pause/play cycle
  (2, 3, 1). Previously none of these fired.
- SponsorBlock overlay matches the progress bar to `dx=dy=dw=dh=0.00` with one marker per
  segment, and survives an in-place replay (no hashchange): `lastOverlayHash` is cleared on
  ENDED and the overlay is rebuilt with the same 0.00 delta.
- Logo tri-state: default `left=1593px w=243px`, premium `left=1578px w=258px` (both move
  together, which is the point), hidden sets `ytaf-hide-logo` and `visibility: hidden`.
- Thumbnails: `maxresdefault` present in the DOM, 52 entries in the `ytaf-thumb-quality` cache.
- Nav filtering: the Live tab disappears with Remove Live Videos on (`News | Live | Music` →
  `News | Music`); Shorts was already absent with its own setting on.
- Panel layout in both themes: every single-column row 41.83px, all label text at one x per
  column, page bottom 1030px inside a 1080px viewport with the scroll fallback engaged.

Three defects were found _by_ this pass and fixed in `311925e` — see that commit. None were
visible to the test suite.

Not verified on device: the RYD em-dash placeholder (needs a video whose RYD request is slow or
failing), Force Video Codec actually changing the negotiated stream (needs a panel that stalls on
AV1), and live _tile_ filtering as opposed to the nav tab (no live tiles were on the home shelf
during the pass).

## Open questions

- `src/perf_mon.js` is a 4600-line dev-only profiler that upstream heavily extended and the fork trimmed; it is commented out at `userScript.js:4` and its function list is already stale relative to the thumbnail rewrite. Left untouched here — worth deleting outright in a separate change if it is not being used.
