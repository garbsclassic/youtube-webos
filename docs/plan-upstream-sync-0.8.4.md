# Upstream sync: 0.8.3 → 0.8.4

Branch `feat/upstream-sync-0.8.4`, stacked on `feat/upstream-sync-0.8.3` (not yet merged to `main`; rebased onto `main` on 2026-09-30, dropping its two `.prettierignore` commits since `main` removed Prettier).

## Goal

Land what upstream 0.8.4 shipped that still applies. The headline is a fix for a YouTube-side regression that is live on the fork today: reopening the comments or description panel after Back renders every row at height 0, stacked at the top, and arrow navigation gets stuck (NicholasBly/youtube-webos#188, #154). Users also get two SponsorBlock readouts: a badge on the title when the whole video is a sponsorship, and the running time with skips removed.

## Divergence

Upstream base for this range is `5f7aa18` (0.8.3 plus a README commit, the tip the 0.8.3 port was taken from); upstream tip is `origin/upstream` at `78a374a` (0.8.4). History is still one squashed `0.8.4` commit, so this is a diff-driven port again.

Every upstream file was converted to CRLF in this range, which inflates the raw diffstat to ~2,700 lines. With `--ignore-cr-at-eol -w` it is ~930, and roughly half of that is comment rewording that removes "the old code did X" archaeology.

## Verdicts

| Upstream change | Verdict | Notes |
| --- | --- | --- |
| `comments-fix.js`: override YouTube's closing-class collapse rules (#188) | APPLIES | Reproduced on the TV on 2026-09-30 before porting: second open of comments gives 21 rows, all `height: 0rem`, one distinct `top`. YouTube's `.app-quality-root .frHKed .AmQJbe { display: none }` is present on the set. |
| `return-dislike.js`: drop the `.TXB27d` / `.ytVirtualListItem` relative-position override (#154) | APPLIES | Coupled with the above. The override stacked rows in DOM order, which YouTube shuffles; comments-fix removes the need for it. |
| `return-dislike.js`: `compensateHeaderGrowth` / `clearHeaderShift` | APPLIES | Replaces the override: pushes rows below the header down by the height the injected dislike factoid added. |
| `sponsorblock-labels.js` / `.css`: full-video badge and time with skips removed | APPLIES | Ported with changes, see Decisions. |
| `sponsorblock.js`: request `actionType=full`, skip full labels in the overlay and segment list, call `updateLabels()` | APPLIES | The fork's `rebuildSkipSegments` already drops non-`skip` actionTypes, so skip logic is safe without a change. |
| Config `sbFullVideoLabel`, `sbShowTimeWithSkips` plus Sponsor-page rows | APPLIES | Typed entries in `config.ts`. |
| `oled_toggle` label → "Toggle OLED Black Overlay" | APPLIES | Separates the shortcut from the OLED-Care Mode setting. |
| Comment rewording across `thumbnail-quality`, `sponsorblock`, `return-dislike`, `adblock`, `ui`, `launch`, `notifications`, `screensaver-fix`, `video-quality` | APPLIES where the fork carries the same comment | The fork's wording differs (rewrapped to 100 columns), so this is a hand edit, not a hunk apply. Matches the fork's no-archaeology comment rule. |
| `spatial-navigation-polyfill.js` perf | N/A | Legacy webOS 3-6 build; the fork ships its own `spatial-navigation.js`, untouched upstream. |
| `adblock.js` emoji-path comments | N/A | The emoji path is deleted in the fork. |
| `emoji-font.js` | N/A | Deleted in the fork. |
| `userScript.js` perf_mon comment | N/A | The fork keeps perf_mon as a commented-out import, not a webpack alias. |
| `bench/*.cjs` | N/A | Same decision as 0.8.3: `node:test` covers this ground. |
| `package.json`, `appinfo.json`, `repo.json`, `dist/*.ipk`, README | N/A | Fork versioning and packaging. |

## Decisions

| Decision | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Exclusive Access label | Add `exclusive_access` to `FETCH_CATEGORIES` | Port as-is | Upstream renders an "Exclusive Access" badge but never requests that category, so it can never appear. Bug in upstream only. |
| Unknown full-label category | Show only the three known categories | Fall back to the raw category string | The badge text comes from the API and lands in a stylesheet; `cssString` escapes it, but there is no reason to render a label nobody defined. |
| Badge icon | `icons/IconSponsorBlocker64px.png`, the fork's bundled SponsorBlock icon | Upstream's `sponsorblock-icon.png` | The fork already bundles one; no second copy. |
| comments-fix override scope (review) | Split selector lists; override only the collapsed properties | Upstream's whole-list, all-properties override | Minified CSS merges identical bodies, so upstream's version could pin unrelated classes such as `.zylon-hidden` laid out. `.AmQJbe` carries an inline `width: 25.5rem` (measured) that `width: auto !important` beat during close. |
| Empty SponsorBlock overlay (review) | Insert it, as before the port | Upstream's early return with `overlay = null` | With no overlay, `checkForProgressBar` never exits early and forces a style recalc per chrome mutation all video long -- the common case once full-only videos keep their handler. |
| Badge colour | Written into the rule, as upstream does | CSS custom property | Upstream's stated reason (Chrome 38) is gone, but the value is still per-state generated CSS either way; no gain from changing it. The Chrome 38 rationale is dropped from the comment. |

## Landmines

1. **Full-video segments are `[0, 0]`.** Anything iterating `this.segments` that is not guarded draws a zero-width overlay marker or lists a `0:00 - 0:00` row. Guarded in `drawOverlay` and `sponsorBlockUI.updateSegments`; `rebuildSkipSegments` already filters by `actionType`.
2. **`drawOverlay` with only full labels.** An empty fragment would still insert an empty `#previewbar`; upstream returns early with `overlay = null`.
3. **`configRead` throws on unknown keys** in the fork's typed config. Upstream's `categoryColor` reads `exclusive_accessColor`, which does not exist; ported verbatim it throws on every Exclusive Access video. Fixed in the port by checking `segmentTypes` first.
4. **`Object.hasOwn` needs Chrome 93**; the build targets Chrome 87 with no polyfills, and ESLint's `prefer-object-has-own` pushes toward it. Avoided in new code; the existing uses in `config.ts` and `ui.js` are a separate bug on `main`.
5. **RYD is off on the test TV** (`enableReturnYouTubeDislike: false` in its config). Header-shift verification needs it switched on and restored afterward.

## Steps

- [x] 1. `comments-fix.js` plus the RYD override removal and header shift. Verify with the #188 repro on the TV, comments and description.
- [x] 2. SponsorBlock labels, config keys, Sponsor-page rows, `full` actionType and `exclusive_access` fetch.
- [x] 3. OLED shortcut rename.
- [x] 4. Archaeology comment trims matching upstream's.
- [x] 5. Tests via the `tester` subagent: `sponsorblock-labels` helpers, comments-fix rule matching and override building, and `rebuildSkipSegments` dropping full labels (`drawOverlay` needs a real DOM, so it is covered on device instead).
- [x] 6. `CHANGELOG.md` entry under the next fork version.
- [x] 7. `reviewer` subagent over `feat/upstream-sync-0.8.3..feat/upstream-sync-0.8.4`.

## Verification

CI gate after each step: `npm run lint && npm run type-check && npm test && npm run build && npm run package`.

On the TV over CDP (see `.local/README.md`): the #188 repro script opens a panel with the bound digit key, presses Back, reopens, and records row heights and distinct `top`s. Pass means the second open matches the first. For labels: the badge's computed `::before` content and colour on a video SponsorBlock labels as full-video sponsor, the duration `::after` content on a video with auto-skip segments, and the Sponsor settings page fitting at 95vh in both themes.

### What was verified on hardware -- 2026-09-30

Measured over CDP on the test TV (webOS 25), deployed by `scp` plus a renderer kill.

- #188 before the port: comments reopened with 21 rows, all `height: 0rem`, one distinct `top`. After: the reopen matches the first open exactly (5 rows, real heights, 5 distinct tops). `comments-fix` picked up `.app-quality-root .frHKed .AmQJbe` from YouTube's live CSS rather than the fallback.
- Description panel with RYD on: factoid injected, header shift 96 px, no row overlaps, identical after close and reopen.
- Badge: Sponsor (`LEENEFaVUzU`, green, white text), Self Promo (`lRiZoaY8pPk`, yellow, black text), Exclusive Access (`fqx-DgdeuMI`, #008a5c). Badge centre within 0.5 px of the title text centre, measured from screenshot pixels.
- Time with skips: `12:30 (10:21)` on `LEENEFaVUzU`, which is only right with the overlapping selfpromo and outro merged; `1:17:41 (1:16:55)` on `fqx-DgdeuMI`; absent on a video with no skip segments.
- Full labels drew no overlay marker and no segment-list row.
- Toggling the badge setting off and on in the panel rewrote the stylesheet live.
- Sponsor settings page: the two new rows are 39 px like their siblings, no scroll, panel bottom 972 px of 1080.

After the review fixes (narrowed comments-fix override, empty overlay restored) the build was redeployed and the TV confirmed the new override text, `.app-quality-root .frHKed .AmQJbe { display: block !important; visibility: hidden !important; }`, but the TV then went to standby before the #188 repro could be rerun against it. **The narrowed override is unverified on hardware**; rerun `repro188` for keys 8 and 7 before release.

Not verified: #154's description-panel scrolling specifically (no panel with the button objects it describes was at hand), the RYD header shift with the description panel scrolled to its last row (review finding 6), and the settings page in the blue theme (the rows reuse the existing checkbox component; the theme changes colour only).
