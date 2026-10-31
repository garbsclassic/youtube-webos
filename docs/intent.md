# Intent

Deliberate choices that look like mistakes. One line each: what it looks like, why it stays.

- **No video playback-speed control.** Looks like a trivially missing feature — the leanback player exposes `setPlaybackRate()` and `getAvailablePlaybackRates()` (0.25–2x), and calls succeed. But the webOS native hardware decoder ignores the rate: measured over CDP on the test TV, `video.playbackRate`/`getPlaybackRate()` report 2 while `currentTime` advances at exactly 1.0x wall-clock (0.5x likewise). The old red-button 2x was pulled for this ("wasn't working for most", CHANGELOG). Real variable-rate playback would require bypassing the decoder in software (audio resample + frame drop/dup) — large effort, degraded quality. Do not "re-add" it by wiring up the player API; it silently no-ops.
