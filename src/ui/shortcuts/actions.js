// What each shortcut does. A `global` action runs anywhere, with nothing
// passed; the others run on a watch or Shorts page with a <video>, which
// `run` receives. `burst` marks the seeks, which batch rapid presses instead
// of being debounced.

import { isShortsPage, isWatchPage } from '../../core/page-state.js';
import { SELECTORS } from '../../core/selectors.js';
import { resetSpeed, stepSpeed } from '../../features/playback-speed/index.js';
import { getSponsorBlock } from '../../features/sponsorblock/bootstrap.js';
import { isOptionsPanelVisible, showOptionsPanel } from '../panel/panel.js';
import { showNotification } from '../toast/index.js';
import { isOledOverlayActive, toggleOledOverlay } from './oled.js';
import { refreshPage } from './page.js';
import { saveToPlaylist, toggleComments, toggleDescription } from './panels.js';
import { playPause, toggleSubtitles } from './playback.js';
import { performBurstSeek, skipChapter } from './seek.js';

/** Runs `fn` with the live SponsorBlock handler, or says there is none. */
function withSponsorBlock(fn) {
  const sb = getSponsorBlock();
  if (sb) fn(sb);
  else showNotification('SponsorBlock not loaded');
}

export const ACTIONS = {
  config_menu: {
    global: true,
    /**
     * Opens or closes the options panel, ending the OLED overlay first (it would cover the panel).
     */
    run: () => {
      // The OLED overlay sits above the panel, so opening the panel ends it.
      if (!isOptionsPanelVisible() && isOledOverlayActive()) toggleOledOverlay();
      showOptionsPanel(!isOptionsPanelVisible());
    }
  },
  toggle_oled: { global: true, run: toggleOledOverlay },
  refresh_page: {
    // Global rather than browse-only, so the press on a player page is answered.
    global: true,
    /** Soft-reloads the page, except on a player page, where it only says it cannot. */
    run: () => {
      if (isWatchPage() || isShortsPage()) showNotification('Cannot refresh on player pages');
      else refreshPage();
    }
  },
  chapter_skip_next: { run: () => skipChapter('next') },
  chapter_skip_prev: { run: () => skipChapter('prev') },
  seek_fwd_10: { burst: true, run: (video, evt) => performBurstSeek(10, !!(evt && evt.repeat)) },
  seek_back_10: { burst: true, run: (video, evt) => performBurstSeek(-10, !!(evt && evt.repeat)) },
  seek_fwd_15: { burst: true, run: (video, evt) => performBurstSeek(15, !!(evt && evt.repeat)) },
  seek_back_15: { burst: true, run: (video, evt) => performBurstSeek(-15, !!(evt && evt.repeat)) },
  seek_fwd_30: { burst: true, run: (video, evt) => performBurstSeek(30, !!(evt && evt.repeat)) },
  seek_back_30: { burst: true, run: (video, evt) => performBurstSeek(-30, !!(evt && evt.repeat)) },
  play_pause: { run: (video) => playPause(video) },
  toggle_subtitles: {
    // The player lookup is here rather than in the router: only this action
    // needs it, and the fallback is a full-document class-selector walk.
    run: () =>
      toggleSubtitles(
        document.getElementById(SELECTORS.PLAYER_ID) ||
          document.querySelector(SELECTORS.HTML5_PLAYER_FALLBACK)
      )
  },
  toggle_comments: { run: toggleComments },
  toggle_description: { run: toggleDescription },
  save_to_playlist: { run: saveToPlaylist },
  sb_skip_prev: {
    /** Jumps back to the start of the last SponsorBlock segment passed. */
    run: () =>
      withSponsorBlock((sb) => {
        if (!sb.skipToPreviousSegment()) showNotification('No previous segment found');
      })
  },
  sb_skip_highlight: {
    /** Skips the segment SponsorBlock is offering, or jumps to the highlight. */
    run: () =>
      withSponsorBlock((sb) => {
        if (!sb.manualSkipOrHighlight()) showNotification('No action available');
      })
  },
  // Playback speed (features/playback-speed; the legacy build says it cannot).
  speed_up: { run: () => stepSpeed(1) },
  speed_down: { run: () => stepSpeed(-1) },
  speed_reset: { run: resetSpeed }
};
