# Remaining resource-usage work

The invariants below are what the fork held before the 0.8.5 rebuild; which of them 0.8.5 still meets is checked in step 5 of the [sync plan](plan-upstream-sync-0.8.5.md). This is a personal-use app; hardware verification is scoped to the owner's LG B4. Keep the remaining experiments dependent on measured benefit rather than changing quality or cache policy speculatively.

## Extend hardware evidence

Use [profile-resource.mjs](../tools/profile-resource.mjs) with `TV_HOST=host:9998` for bounded `status`, `window`, and `settings` captures. The settings workload records keydown-to-next-animation-frame callback time with counters enabled, validates focus movement, and restores its instrumentation automatically. This is not physical display latency. Keep raw traces, configuration snapshots, and results outside tracked working documents.

- Repeat matched cases on the owner's TV. Preserve stream/content/configuration and distinguish fresh-process starts, warm resumes, and cold network/cache effects.
- Establish startup, input, and memory budgets for that TV from repeated batches. Do not infer absence of a startup regression from overlapping ranges, or total RAM savings from JS heap or callback FPS.
- Separate native/decoded-image/GPU memory from JS heap and process RSS/PSS. Heap snapshots and forced collection must remain outside latency and CPU sampling windows.
- Broaden native buffering, autoplay, manual-skip/highlight, and controls-transition samples before assigning a strict skip-accuracy or overlay-transition budget.

Keep diagnostics opt-in. The continuous overlay in [perf-mon.js](../src/dev/perf-mon.js) adds animation callbacks, observer interception, document scans, and DOM updates; do not use its callback FPS as decoded-frame, CPU, or total-memory evidence.

## Profile required response filtering before changing it

The optional thumbnail fallback distinguishes recognized no-op structures and has a shared enqueue budget. Excess optional thumbnail URLs remain unchanged. Required ad filtering must never be silently dropped by such a cap. Keep lookup depth inclusive while avoiding expansion of unsearched children beyond that boundary; count each matched key only once, including falsy values.

Read the bounded counters from `window.__ytafAdblockStats` (fallback searches and nodes visited), `window.__ytafThumbStats`, `window.__ytafQualityStats` and `window.__ytafContinuationStats`. These counters retain no payloads. Use representative responses to identify frequent schema misses and duplicated walks in [features/adblock/](../src/features/adblock/) (the bounded walk is [core/bounded-search.js](../src/core/bounded-search.js)). Add known paths first; only consolidate passes or bound required-filter traversal after large/changed-schema fixtures establish the fallback policy. Preserve native parse, caller revivers, stringify semantics, codec behavior, and in-place filtering.

## Keep quality and cache changes evidence-gated

- Compare a balanced, slot-appropriate thumbnail policy with the explicit maximum-quality choice only when native image/decode costs can be measured. Use response dimensions and proven variants rather than parse-time per-tile layout reads. Adopt it only with a measured benefit and acceptable image quality.
- Keep existing cache and concurrency limits unless hit rate, retained size, and visible-correction latency justify changing them. Keep safe/eager gray-tile recovery, custom crops, current-surface priority, single-layer promotions, and bounded idle work. Select current-surface probes from the rendered set and keep offscreen work FIFO. Entries without write-back/probe capacity must stay on proven URLs; restore proven URLs before evicting references and preserve newer proof through in-flight completion.
- Retain launch animation behavior unless matched navigation CPU/input measurements and focus checks establish a benefit from changing it. Keep speech/voice flags outside that experiment.
- Keep resolution and codec forcing opt-in. Measure the actual decoder before recommending a codec or changing maximum-quality policy. Playback speed bypasses the decoder (timeline rescale plus WSOLA audio) and holds 1080p above 1.25x; measure `currentTime` against wall clock before changing it.
- Split the userscript or externalize embedded assets only if startup parse/compile profiles justify it. Verify remote-page asset loading in the packaged app first; keep filtering and early remote-key registration synchronous.

## Verification for follow-up changes

Use focused `.cjs` regressions under `tests/` and rerun lint, type checking, tests, production build, and packaging. Repeat the affected matched hardware scenario after each change. Visually verify changed UI with dimensions/alignment/spacing in both configured themes and OLED mode; report unavailable coverage explicitly.

Navigation must preserve both columns, disabled controls, tab wrap-around, Back, and overflow scrolling. The settings panel owns its native scroll events because YouTube's global scroll listener otherwise resets its offsets. Cache geometry only within a read phase and invalidate it after focus/scroll writes; explicit keyboard navigation must not reuse a previous mouse origin.

At most one current feature/player owner may retain work. Disabled clocks must not create intervals later; departed handlers must cancel waiters, requests through body consumption, and deferred quality callbacks. Preserve shared player-state events with forced quality off. Leave description navigation native and preserve the close-collapse workaround in [comments-fix.js](../src/features/comments-fix.js). Default-disabled thumbnail mode must schedule no thumbnail work.
