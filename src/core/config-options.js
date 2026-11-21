// Every setting the app knows about, with its default and the label the
// options panel shows, plus the value tables the cycle controls choose from.
// An option's `upgrade(stored)` turns a value an older build stored into this
// build's (core/config.js applies it when the settings load).
import { capitalize } from './text.js';

// The SponsorBlock categories: the overlay colour and opacity, `name` as the
// toasts say it ("Skipped sponsored segment") and `label` as the segment list
// shows it.
export const segmentTypes = {
  sponsor: { color: '#00d400', opacity: '0.7', name: 'sponsored', label: 'Sponsor' },
  intro: { color: '#00ffff', opacity: '0.7', name: 'intro', label: 'Intermission/Intro' },
  outro: { color: '#0202ed', opacity: '0.7', name: 'outro', label: 'Endcards/Credits' },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder',
    label: 'Interaction'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: 'self-promotion',
    label: 'Unpaid/Self Promotion'
  },
  musicofftopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: 'non-music part',
    label: 'Non-Music Section'
  },
  preview: { color: '#008fd6', opacity: '0.7', name: 'recap or preview', label: 'Preview/Recap' },
  poi_highlight: { color: '#ff1684', opacity: '0.8', name: 'highlight', label: 'Highlight' },
  filler: { color: '#7300ff', opacity: '0.7', name: 'tangents/jokes', label: 'Filler/Tangents' },
  hook: { color: '#395699', opacity: '0.7', name: 'hook/greetings', label: 'Hook/Greetings' }
};

/** The looks of the options panel and the toasts (ui/styles/html-classes.js). */
export const uiThemes = {
  'blue-force-field': 'Blue',
  'classic-red': 'Classic Red'
};

// The header wordmark: YouTube's own (left as YouTube draws it), the Premium
// one, or none; how each is applied is in features/logo-style.js.
export const logoStyles = {
  default: 'Default',
  premium: 'Premium',
  hidden: 'Hidden'
};

/**
 * Max Thumbnail Quality strategy.
 *
 * 'safe'    - only ever emit a derivative already known to exist, so a tile can
 *             never land on a 404. Upgrades past that arrive once verified.
 *             The default.
 * 'eager'   - go straight to maxresdefault. Sharpest first paint, but videos
 *             with no maxres show a grey box until the correction lands.
 * 'sd'      - 'eager' semantics, but never reaches past sddefault (640x480):
 *             about a quarter of the decode work of maxres per tile, and drawn
 *             from the first frame, so a new tile is never swapped from a
 *             lower rung; the rare video with no sddefault shows a grey box
 *             until the correction lands, and no correction runs while the
 *             remote's arrow keys are moving. The choice for smooth row-to-row
 *             navigation on slower TVs.
 */
export const thumbnailQualityModes = {
  safe: 'Original',
  eager: 'Fast',
  sd: 'Smooth (SD)'
};

/** Display Time in UI: no clock, the time, or the date and time (features/watch). */
export const clockModes = {
  off: 'Off',
  time: 'Time',
  datetime: 'Date + Time'
};

export const shortcutActions = {
  none: 'None',
  refresh_page: 'Refresh Page',
  play_pause: 'Play/Pause',
  toggle_oled: 'Toggle Black Overlay',
  seek_back_10: 'Rewind 10s',
  seek_back_15: 'Rewind 15s',
  seek_back_30: 'Rewind 30s',
  seek_fwd_10: 'Fast Forward 10s',
  seek_fwd_15: 'Fast Forward 15s',
  seek_fwd_30: 'Fast Forward 30s',
  chapter_skip_prev: 'Previous Chapter',
  chapter_skip_next: 'Next Chapter',
  sb_skip_prev: 'Previous SponsorBlock Segment',
  sb_skip_highlight: 'Skip SB Segment / Jump to Highlight',
  speed_down: 'Playback Speed Down',
  speed_up: 'Playback Speed Up',
  speed_reset: 'Playback Speed Reset',
  toggle_description: 'Toggle Description',
  toggle_comments: 'Toggle Comments',
  toggle_subtitles: 'Toggle Subtitles',
  save_to_playlist: 'Save to Playlist',
  config_menu: 'Open/Close Settings'
};

export const sbModes = {
  auto_skip: 'Auto Skip',
  manual_skip: 'Manual Skip',
  seek_bar: 'Show in Seek Bar',
  disable: 'Disable'
};

export const sbModesHighlight = {
  auto_skip: 'Auto Skip to Start',
  ask: 'Ask when video loads',
  seek_bar: 'Show in Seek Bar',
  disable: 'Disable'
};

export const forcePreviewModes = {
  disabled: 'Disabled',
  force_on: 'Force On',
  force_off: 'Force Off'
};

/**
 * Force Video Codec.
 *
 * 'auto' leaves the player and the server to negotiate, which is what the app
 * has always done. Everything else narrows what the player will accept - see
 * features/force-codec. 'no_av1' is kept separate from 'vp9' because opting out
 * of AV1 (issue #143) should not also cost a set its AVC fallback.
 */
export const videoCodecModes = {
  auto: 'Auto',
  av1: 'AV1',
  vp9: 'VP9',
  avc: 'AVC (H.264)',
  hevc: 'HEVC (H.265)',
  no_av1: 'Avoid AV1'
};

export const configOptions = new Map([
  ['uiTheme', { default: 'blue-force-field', desc: 'UI Theme' }],
  ['enableAdBlock', { default: true, desc: 'Ad Blocking' }],
  ['enableTrackingBlock', { default: false, desc: 'Reduce Telemetry & Tracking' }],
  ['enablePlaybackSpeed', { default: false, desc: 'Playback Speed (experimental)' }],
  ['upgradeThumbnails', { default: false, desc: 'Max Thumbnail Quality' }],
  ['thumbnailQualityMode', { default: 'safe', desc: 'Thumbnail Strategy' }],
  ['removeGlobalShorts', { default: false, desc: 'Remove Shorts (Global)' }],
  ['removeLiveVideos', { default: false, desc: 'Remove Live Videos (Global)' }],
  ['removeTopLiveGames', { default: false, desc: 'Remove Top Live Games' }],
  ['removeMostRelevant', { default: false, desc: 'Remove "Most Relevant" Shelf' }],
  ['enableRowsAhead', { default: true, desc: 'Load Rows Ahead' }],
  ['enableSponsorBlock', { default: true, desc: 'SponsorBlock' }],
  ['enableMutedSegments', { default: false, desc: 'Allow segments that mute audio' }],
  ['skipSegmentsOnce', { default: false, desc: 'Skip Segments Once' }],
  [
    'sbFullVideoLabel',
    { default: false, desc: 'Show an icon when a video is entirely an advertisement' }
  ],
  ['sbShowTimeWithSkips', { default: false, desc: 'Show time with skips removed' }],
  ['sbMode_sponsor', { default: 'auto_skip', desc: 'Sponsor' }],
  ['sbMode_intro', { default: 'auto_skip', desc: 'Intermission/Intro' }],
  ['sbMode_outro', { default: 'auto_skip', desc: 'Endcards/Credits' }],
  ['sbMode_interaction', { default: 'auto_skip', desc: 'Interaction Reminder' }],
  ['sbMode_selfpromo', { default: 'auto_skip', desc: 'Self Promotion' }],
  ['sbMode_musicofftopic', { default: 'auto_skip', desc: 'Non-Music Section' }],
  ['sbMode_preview', { default: 'seek_bar', desc: 'Preview/Recap' }],
  ['sbMode_filler', { default: 'seek_bar', desc: 'Filler/Tangents' }],
  ['sbMode_hook', { default: 'seek_bar', desc: 'Hook/Greetings' }],
  ['sbMode_highlight', { default: 'seek_bar', desc: 'Highlight' }],
  ['hideEndcards', { default: false, desc: 'Hide Endcards' }],
  ['enableAutoLogin', { default: true, desc: 'Bypass Nag Screens' }],
  ['logoStyle', { default: 'default', desc: 'YouTube Logo' }],
  [
    'showWatch',
    {
      default: 'off',
      desc: 'Display Time in UI',
      // Up to 0.8.4 a checkbox: true was the time alone.
      upgrade: (value) => {
        if (value === true) return 'time';
        if (value === false) return 'off';
        return value;
      }
    }
  ],
  ['enableOledCareMode', { default: false, desc: 'OLED-Care Mode (True Black UI)' }],
  ['videoShelfOpacity', { default: 100, desc: 'Video shelf opacity' }],
  ['fixMultilineTitles', { default: true, desc: 'Fix Multiline Titles' }],
  ['fixSearchFont', { default: true, desc: 'Fix Search Results Font' }],
  ['removeBlackBorders', { default: false, desc: 'New Liquid Glass UI' }],
  ['forcePreviews', { default: 'disabled', desc: 'Force Previews' }],
  ['enableLegacyEmojiFix', { default: true, desc: 'Emoji + Characters Fix' }],
  ['hideGuestSignInPrompts', { default: false, desc: 'Guest Mode: Hide Sign-in Buttons' }],
  ['forceHighResVideo', { default: false, desc: 'Force Max Quality' }],
  ['forceVideoCodec', { default: 'auto', desc: 'Force Video Codec' }],
  ['disableNotifications', { default: false, desc: 'Disable Notifications' }]
]);

/** The configurable shortcut keys: the digits and the colour keys (ui/shortcuts/bindings.js). */
export const SHORTCUT_KEYS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'red',
  'green',
  'yellow',
  'blue'
];

// The shortcut bindings: 5 skips to the next chapter by default, red is the
// OLED overlay, green this panel, blue the SponsorBlock skip. Yellow stays
// None so the TV's own yellow (search) works until a binding claims it.
const SHORTCUT_DEFAULTS = {
  5: 'chapter_skip_next',
  red: 'toggle_oled',
  green: 'config_menu',
  blue: 'sb_skip_highlight'
};
for (const key of SHORTCUT_KEYS) {
  configOptions.set(`shortcut_key_${key}`, {
    default: SHORTCUT_DEFAULTS[key] || 'none',
    desc: key.length === 1 ? `Key ${key}` : `${capitalize(key)} Button`
  });
}

for (const [key, value] of Object.entries(segmentTypes)) {
  configOptions.set(`${key}Color`, { default: value.color, desc: `Color for ${value.name}` });
}
