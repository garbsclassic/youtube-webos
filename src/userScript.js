// The script webOS runs inside YouTube's TV site (built as
// webOSUserScripts/userScript.js). It loads every feature, installs the global
// hooks and handles launches and relaunches; the order of the imports below
// is the order things start in (docs/ARCHITECTURE.md).

// Dev diagnostics, aliased to an empty module unless built with `--env perf`.
// MUST come before every other module: perf-mon installs
// "inner" probes underneath every other hook.
import './dev/perf-mon.js';

import {
  installParseHook,
  installStringifyHook,
  startTrackingBlock
} from './features/adblock/index.js';
import { installCodecHooks } from './features/force-codec/index.js';

import { SELECTORS } from './core/selectors.js';
import { handleLaunch, extractLaunchParams, hasLaunchTarget } from './core/launch.js';
import { attemptActiveBypass, resetActiveBypass } from './features/auto-login/index.js';
import { isWebOS25, simulatorMode } from './core/webos.js';
import { initBlockWebOSCast } from './features/block-webos-cast.ts';
// Each module registers its page listeners as it is imported, so they run in
// this order.
import './features/return-dislike/index.js';
import './features/video-quality/index.js';
import { initLogoStyle } from './features/logo-style.js';
import './ui/index.js';
import './features/sponsorblock/index.js';
import './features/screensaver-fix/index.js';
import './features/comments-fix.js';
import './features/watch/index.js';
import './features/lang-settings-fix.ts';
// Installs itself once its setting is on.
import './features/playback-speed/index.js';
import { createLogger } from './core/log.js';

const log = createLogger('Main');

// The global hooks, installed once every module has loaded (the codec filter
// runs inside the parse hook).
installParseHook();
installStringifyHook();
installCodecHooks();

// The features that start once the hooks are in: the wordmark style applies
// to the header, and Tracking Block's network hooks follow the adblock flags
// (it rides on Ad Blocking, as the panel shows).
initLogoStyle();
startTrackingBlock();

(function oneTimeParamsCheck() {
  const params = extractLaunchParams();
  if (params && Object.keys(params).length > 0) {
    attemptActiveBypass();
  }
})();

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    log.info('Relaunch:', evt, window.launchParams);
    resetActiveBypass();
    if (document.body && document.body.classList.contains(SELECTORS.ACCOUNT_SELECTOR)) {
      log.info('Relaunch detected on Account Selector. Triggering bypass.');
      attemptActiveBypass(true);
    }
    // A plain relaunch has nothing to open: going to #/ would leave YouTube on
    // the video it is playing but end SponsorBlock and the dislike counter
    // for it (core/per-video.js sees a page without a video).
    if (hasLaunchTarget(evt.detail)) handleLaunch(evt.detail);
    else log.info('Plain relaunch: staying on the current page');
  },
  true
);

if (isWebOS25() && simulatorMode === false) {
  log.info('Enabling webOS Google Cast Block');
  initBlockWebOSCast();
}
