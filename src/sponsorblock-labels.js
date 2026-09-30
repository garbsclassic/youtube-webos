import { configRead, segmentTypes } from './config';
import './sponsorblock-labels.css';

/**
 * Two SponsorBlock readouts rendered onto YouTube's own elements:
 *
 *   1. Full-video badge -- a coloured pill before the video title when SponsorBlock labels the
 *      whole video a sponsorship, self-promo or exclusive access, as the desktop extension does.
 *   2. Time with skips removed -- the duration minus everything that will be skipped, in
 *      brackets after the duration under the seek bar.
 *
 * Neither touches the DOM. Both are pseudo-elements whose styling lives in
 * sponsorblock-labels.css without a `content`, so nothing renders until this module writes one
 * stylesheet supplying it. incremental-dom deletes children it did not render, and the host
 * elements do not exist until the player chrome is built; a selector rule applies the instant a
 * matching element exists and survives every rebuild, with nothing to observe or retry. The
 * cost is one textContent write when the value changes, roughly once per video.
 */

const DEBUG = false;

// Scoped to the watch page's metadata so the badge cannot leak onto other titles that reuse the
// same idomkey.
const BADGE_SELECTOR =
  'ytlr-watch-metadata [idomkey="title-text"]::before,' +
  'ytlr-video-title-tray [idomkey="title-text"]::before';

// On the duration span, not its time-label parent, which lays elapsed and duration out at
// opposite ends of the seek bar. Here it reads "42:49 (27:07)".
const TIME_SELECTOR = '[idomkey="time-label"] [idomkey="duration"]::after';

const FALLBACK_COLOR = '#00d400';

// exclusive_access is full-video only: no skip mode and no colour setting. Kept here rather than
// in segmentTypes, which would mint a colour picker and mode control for it.
const EXTRA_FULL_COLORS = { exclusive_access: '#008a5c' };

const FULL_LABELS = {
  sponsor: 'Sponsor',
  selfpromo: 'Self Promo',
  exclusive_access: 'Exclusive Access'
};

// Sponsor wins over a self-promo or exclusive-access label on the same video: it is the
// strongest claim and the one the badge exists to warn about.
const FULL_PRIORITY = ['sponsor', 'selfpromo', 'exclusive_access'];

// Category -> skip-mode config key. Mirrors CONFIG_MAPPING in sponsorblock.js.
const SEGMENT_MODE_KEYS = {
  sponsor: 'sbMode_sponsor',
  intro: 'sbMode_intro',
  outro: 'sbMode_outro',
  interaction: 'sbMode_interaction',
  selfpromo: 'sbMode_selfpromo',
  musicofftopic: 'sbMode_musicofftopic',
  preview: 'sbMode_preview',
  filler: 'sbMode_filler',
  hook: 'sbMode_hook'
};

function isCategoryDisabled(category) {
  const modeKey = SEGMENT_MODE_KEYS[category];
  return !!modeKey && configRead(modeKey) === 'disable';
}

/** mm:ss, or h:mm:ss past an hour. */
export function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A quoted CSS string. Everything passed here is generated, but it lands in a stylesheet. */
export function cssString(value) {
  const escaped = String(value)
    .replace(/[\\"]/g, '\\$&')
    .replace(/[\n\r]/g, ' ');
  return `"${escaped}"`;
}

/** #rgb or #rrggbb only; anything else is refused rather than written into CSS. */
export function safeColor(value, fallback) {
  const str = String(value).trim();
  return /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(str) ? str : fallback;
}

/** Black or white text for a user-chosen background -- selfpromo defaults to pure yellow. */
export function contrastColor(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  // Rec. 709 luma, close enough for a two-way choice.
  const luma =
    (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luma > 0.6 ? '#000' : '#fff';
}

export function categoryColor(category) {
  if (Object.hasOwn(segmentTypes, category)) {
    return safeColor(configRead(`${category}Color`) || segmentTypes[category].color, FALLBACK_COLOR);
  }
  return EXTRA_FULL_COLORS[category] || FALLBACK_COLOR;
}

/** A segment the API returned as a whole-video label. Its range is [0, 0]. */
export function isFullVideoSegment(segment) {
  return !!segment && segment.actionType === 'full';
}

/**
 * Seconds removed by skipping, with overlaps counted once.
 *
 * Every category the user has not disabled comes off: Auto Skip and Manual Skip because they
 * will be skipped, Show in Seek Bar because that is what the readout promises. Overlaps are
 * merged because SponsorBlock regularly returns the same stretch under two categories, and
 * summing would subtract it twice.
 */
export function skippableSeconds(segments, duration) {
  if (!segments || segments.length === 0) return 0;

  const ranges = [];
  for (const seg of segments) {
    if (!seg || !seg.segment) continue;

    // A muted segment is still watched, a highlight is a point, a chapter is a label, and a
    // full-video label is [0, 0].
    if (seg.actionType && seg.actionType !== 'skip') continue;
    if (seg.category === 'poi_highlight' || seg.category === 'chapter') continue;
    if (isCategoryDisabled(seg.category)) continue;

    let start = Number(seg.segment[0]);
    let end = Number(seg.segment[1]);
    if (isNaN(start) || isNaN(end) || end <= start) continue;

    if (duration > 0) {
      start = Math.max(0, Math.min(start, duration));
      end = Math.max(0, Math.min(end, duration));
      if (end <= start) continue;
    }
    ranges.push([start, end]);
  }

  if (ranges.length === 0) return 0;
  ranges.sort((a, b) => a[0] - b[0]);

  let total = 0;
  let [curStart, curEnd] = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    if (start <= curEnd) {
      if (end > curEnd) curEnd = end;
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  return total + (curEnd - curStart);
}

/** The full-video label to show, or null. Disabled categories never show a badge. */
export function pickFullLabel(segments) {
  if (!segments || segments.length === 0) return null;

  const present = new Set();
  for (const seg of segments) {
    if (isFullVideoSegment(seg) && !isCategoryDisabled(seg.category)) present.add(seg.category);
  }
  return FULL_PRIORITY.find(category => present.has(category)) || null;
}

/** The stylesheet for the current state; empty means show nothing. */
export function buildCss(segments, duration) {
  let css = '';

  if (configRead('sbFullVideoLabel')) {
    const category = pickFullLabel(segments);
    if (category) {
      const background = categoryColor(category);
      css +=
        `${BADGE_SELECTOR}{content:${cssString(FULL_LABELS[category])};` +
        `background-color:${background};color:${contrastColor(background)};}`;
    }
  }

  if (configRead('sbShowTimeWithSkips') && duration > 0) {
    const skipped = skippableSeconds(segments, duration);
    // Under a second removed would just repeat the duration beside it.
    if (skipped >= 1) {
      const remaining = formatTime(duration - skipped);
      css += `${TIME_SELECTOR}{content:${cssString(`(${remaining})`)};}`;
    }
  }

  return css;
}

class SponsorBlockLabels {
  constructor() {
    this.styleEl = null;
    this.css = '';
  }

  write(css) {
    if (css === this.css && this.styleEl?.isConnected) return;
    this.css = css;

    if (!css) {
      if (this.styleEl) this.styleEl.textContent = '';
      return;
    }

    if (!this.styleEl?.isConnected) {
      this.styleEl = document.createElement('style');
      this.styleEl.id = 'sb-labels';
      (document.head || document.documentElement).appendChild(this.styleEl);
    }
    this.styleEl.textContent = css;
    if (DEBUG) console.info('[SB-Labels] wrote', css);
  }

  update(segments, duration) {
    this.write(buildCss(segments, duration));
  }

  clear() {
    this.write('');
  }
}

export default new SponsorBlockLabels();
