// Seeking: chapter skips read off the progress bar, and burst seeking that
// batches rapid presses into one jump.

import { getVideo } from '../../core/dom.js';
import { isShortsPage } from '../../core/page-state.js';
import { REMOTE_KEYS, sendKey } from '../../core/remote.js';
import { SELECTORS } from '../../core/selectors.js';
import { showNotification } from '../toast/index.js';
import { simulateBack } from './helpers.js';
import { log } from './log.js';

// The progress bar only carries the chapter markers once the player UI has
// been shown, so the first skip on a video may have to force it open. Tracked
// per video source so each new video gets one forced attempt.
let chaptersForcedFor = '';

// The burst seek: the total shown in the toast, the part not applied to the
// video yet, the step the next press adds, how many presses the run has had,
// and the two timers.
let seekAccumulator = 0;
let pendingSeekOffset = 0;
let seekStep = 0;
let seekPresses = 0;
// The bound step of the run (10, -15, ...): another seek key starts its doubling over.
let seekBase = 0;
let seekResetTimer = null;
let seekApplyTimer = null;

// The presses of one run that keep the bound step: from the next one on, each
// press doubles the step, so a 15s seek runs 15, 30, 60, 120, 240 in total.
const PLAIN_PRESSES = 2;
// A forward burst stops this far short of the end, so a long one does not
// end a playing video and start the next one before the user can react (1s
// was measured on the B4 to end it a second after the seek landed).
const END_MARGIN_S = 5;
const SEEK_APPLY_MS = 200;
const SEEK_RESET_MS = 1200;

/**
 * The chapter markers on the progress bar, empty until the player UI has drawn
 * them; the track's other children (the playhead, the buffer) are left out.
 */
function getChapterEls() {
  const bar = document.querySelector(SELECTORS.PROGRESS_BAR_TRACK);
  const markers = [];
  if (!bar) return markers;
  const children = bar.children;
  for (let i = 0; i < children.length; i++) {
    const key = children[i].getAttribute('idomkey');
    if (key && key.indexOf(SELECTORS.CHAPTER_MARKER_PREFIX) === 0) markers.push(children[i]);
  }
  return markers;
}

/** The player UI was forced open for the markers; close it again once the seek is in. */
const dismissForcedUI = () => setTimeout(simulateBack, 250);

// A second press during the 500 ms the forced UI takes would see
// chaptersForcedFor already set and report "No chapters found" while the
// first press is still waiting for them.
let skipInFlight = false;

/** Skips to the next or previous chapter; one skip at a time, never on Shorts. */
export async function skipChapter(direction = 'next') {
  if (skipInFlight || isShortsPage()) return;
  skipInFlight = true;
  try {
    await doSkipChapter(direction);
  } finally {
    skipInFlight = false;
  }
}

/** The chapter widths off the bar's markers, and their sum (0 when none has a width). */
function readChapters(chapterEls) {
  const widths = [];
  let total = 0;
  for (let i = 0; i < chapterEls.length; i++) {
    const width = parseFloat(chapterEls[i].style.width || '0');
    total += width;
    widths.push(width);
  }
  return { widths, total };
}

/**
 * Where the skip lands, or -1: forward, the first chapter starting more than
 * a second past the playhead; back, the start of the current chapter, or of
 * the one before it within the first three seconds of the current one.
 */
function pickChapterTarget(chapters, duration, currentTime, direction) {
  let currentChapterStart = 0;
  let prevChapterStart = 0;
  let accumulatedWidth = 0;

  for (let i = 0; i < chapters.widths.length; i++) {
    const startTimestamp = (accumulatedWidth / chapters.total) * duration;
    accumulatedWidth += chapters.widths[i];

    if (direction === 'next') {
      if (startTimestamp > currentTime + 1) return startTimestamp;
    } else if (currentTime >= startTimestamp) {
      prevChapterStart = currentChapterStart;
      currentChapterStart = startTimestamp;
    } else {
      break;
    }
  }
  if (direction === 'next') return -1;
  return currentTime - currentChapterStart > 3 ? currentChapterStart : prevChapterStart;
}

/**
 * Reads the chapters from the progress bar (showing the player UI first when they are not
 * rendered), then seeks to the next or previous one.
 */
async function doSkipChapter(direction) {
  const video = getVideo();
  if (!video || !video.duration) return;

  const currentSrc = video.src || window.location.href;
  let chapterEls = getChapterEls();
  let wasForcedNow = false;

  if (chapterEls.length === 0 && chaptersForcedFor !== currentSrc) {
    log.debug('No chapters found. Forcing UI...');
    chaptersForcedFor = currentSrc;
    wasForcedNow = true;
    showNotification('Loading chapters...');
    sendKey(REMOTE_KEYS.ENTER);
    await new Promise((resolve) => setTimeout(resolve, 500));
    chapterEls = getChapterEls();
  }

  if (chapterEls.length === 0) {
    showNotification('No chapters found');
    if (wasForcedNow) dismissForcedUI();
    return;
  }

  const chapters = readChapters(chapterEls);
  if (chapters.total === 0) {
    // Markers without a width say nothing about where a chapter starts.
    showNotification('No chapters found');
    if (wasForcedNow) dismissForcedUI();
    return;
  }

  const targetTime = pickChapterTarget(chapters, video.duration, video.currentTime, direction);

  // Back always has a chapter start to go to, at worst the video's own.
  if (targetTime !== -1 && targetTime < video.duration) {
    video.currentTime = targetTime;
    showNotification(direction === 'next' ? 'Next Chapter' : 'Previous Chapter');
  } else {
    showNotification('No next chapter');
  }
  if (wasForcedNow) dismissForcedUI();
}

/**
 * The size of the next press's jump: the bound step for the first two presses
 * of a run, double the last one from the third on. A held key's repeat keeps
 * the step it has, so holding a key never runs away to the end of the video.
 */
export function nextSeekStep(seconds, presses, lastStep, repeat) {
  if (presses < PLAIN_PRESSES || lastStep === 0) return seconds;
  return repeat ? lastStep : lastStep * 2;
}

/** Moves the video by the part not applied yet, clamped to the video. */
function applyPendingSeek() {
  seekApplyTimer = null;
  if (pendingSeekOffset === 0) return;
  // Looked up now, not at the press: YouTube can swap the <video> between them.
  const video = getVideo();
  if (!video) return;
  const offset = pendingSeekOffset;
  pendingSeekOffset = 0;
  const duration = video.duration;
  const current = video.currentTime;
  let target = current + offset;
  if (offset > 0 && duration > 0 && isFinite(duration)) {
    // Never backwards: already inside the margin, a forward seek stays put.
    target = Math.max(current, Math.min(target, duration - END_MARGIN_S));
  }
  target = Math.max(0, target);
  // Setting the same time still starts a seek that never settles on the B4.
  if (target !== current) video.currentTime = target;
}

/**
 * One press of a burst: the toast shows the running total at once, the video
 * is moved by the pending part once the presses pause for 200 ms (a seek per
 * press froze the UI), and a change of direction starts the run over (toast
 * total, press count and step); the part not applied yet still counts. From
 * the third press of a run the step doubles (nextSeekStep); another seek key
 * in the same direction adds to the total but starts its own doubling over.
 * The reset 1.2s
 * later ends only the run: the part not applied yet is the seek timer's, and
 * a stalled event loop may run the two in either order.
 */
export function performBurstSeek(seconds, repeat = false) {
  if ((seekAccumulator > 0 && seconds < 0) || (seekAccumulator < 0 && seconds > 0)) {
    seekAccumulator = 0;
    seekPresses = 0;
    seekStep = 0;
  }
  if (seconds !== seekBase) {
    seekBase = seconds;
    seekPresses = 0;
    seekStep = 0;
  }
  seekStep = nextSeekStep(seconds, seekPresses, seekStep, repeat);
  seekPresses++;
  seekAccumulator += seekStep;
  pendingSeekOffset += seekStep;
  if (seekResetTimer) clearTimeout(seekResetTimer);

  const directionSymbol = seekAccumulator > 0 ? '+' : '';
  showNotification(`Seek ${directionSymbol}${seekAccumulator}`, 3000, 'seek');

  if (seekApplyTimer) clearTimeout(seekApplyTimer);
  seekApplyTimer = setTimeout(applyPendingSeek, SEEK_APPLY_MS);

  seekResetTimer = setTimeout(() => {
    seekAccumulator = 0;
    seekPresses = 0;
    seekStep = 0;
    seekBase = 0;
    seekResetTimer = null;
  }, SEEK_RESET_MS);
}
