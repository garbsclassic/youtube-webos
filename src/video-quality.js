import { configRead, configAddChangeListener, configRemoveChangeListener } from './config';
import { showNotification } from './notifications.js';
import { isWebOS25 } from './webos-utils.js';
import { sendKey, REMOTE_KEYS, SELECTORS, isWatchPage } from './utils.js';

const DEBUG = false;

const TARGET_QUALITIES = new Set([
  'highres',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large',
  'medium',
  'small',
  'tiny'
]);

const IS_WEBOS_25 = isWebOS25();
const QUALITY_KEY = 'yt-player-quality';
const ONE_YEAR_MS = 31536000000; // 365 * 24 * 60 * 60 * 1000

// Caching: In-memory cache for localStorage & Config
let cachedQualitySettings = null;
let _shouldForce = false;

let player = null;
let lastVideoId = null;
let initTimer = null;
let configCleanup = null;
let isDestroyed = false;
let lastWriteTime = 0;
let statePollingInterval = null;
let lastKnownState = null;
let _isWatchPageCached = false;
let videoBeingProcessed = null;
let kickstartInProgress = false;
let session = 0;
let attachedHash = null;
let stateListener = null;
let hideStyle = null;
let pausedForUpgrade = null;
const qualityTimers = new Set();
const qualityFrames = new Set();

function isCurrentSession(owner, generation) {
  return !isDestroyed && _shouldForce && player === owner && owner?.isConnected &&
    generation === session && attachedHash === window.location.hash && isWatchPage();
}

function qualityTimeout(callback, delay) {
  const owner = player;
  const generation = session;
  const id = setTimeout(() => {
    qualityTimers.delete(id);
    if (isCurrentSession(owner, generation)) callback();
  }, delay);
  qualityTimers.add(id);
}

function qualityFrame(callback) {
  const owner = player;
  const generation = session;
  const id = requestAnimationFrame(() => {
    qualityFrames.delete(id);
    if (isCurrentSession(owner, generation)) callback();
  });
  qualityFrames.add(id);
}

function cancelQualityWork() {
  session++;
  qualityTimers.forEach(clearTimeout);
  qualityTimers.clear();
  qualityFrames.forEach(cancelAnimationFrame);
  qualityFrames.clear();
  hideStyle?.remove();
  hideStyle = null;
  pausedForUpgrade = null;
  videoBeingProcessed = null;
  kickstartInProgress = false;
}

const qualitySetForVideo = new Set();

// webOS 25 first video fix
let hasKickstarted = false;

// Player States
const STATE_UNSTARTED = -1;
// const STATE_ENDED = 0;
const STATE_PLAYING = 1;
// const STATE_PAUSED = 2;
const STATE_BUFFERING = 3;
// const STATE_CUED = 5;

function isForceEnabled() {
  return _shouldForce && (!player?.isInline || !player.isInline());
}

function ensurePlaybackStarts() {
  if (!IS_WEBOS_25 || hasKickstarted || !isForceEnabled() || isDestroyed ||
      !player || kickstartInProgress) return;

  kickstartInProgress = true;
  const owner = player;
  const generation = session;
  let attempts = 0;
  const attempt = () => {
    if (!isCurrentSession(owner, generation)) return;
    try {
      if (owner.getPlayerState?.() === STATE_PLAYING) {
        hasKickstarted = true;
        kickstartInProgress = false;
        qualityFrame(() => {
          const controls = document.querySelector('yt-focus-container[idomkey="controls"]');
          if (!controls?.classList.contains('MFDzfe--focused')) return;
          hideStyle = document.createElement('style');
          hideStyle.textContent = '.GLc3cc { opacity: 0 !important; transition: opacity 0.1s; }';
          document.head.appendChild(hideStyle);
          sendKey(REMOTE_KEYS.UP);
          qualityTimeout(() => sendKey(REMOTE_KEYS.UP), 250);
          qualityTimeout(() => sendKey(REMOTE_KEYS.UP), 500);
          qualityTimeout(() => {
            hideStyle?.remove();
            hideStyle = null;
          }, 750);
        });
        return;
      }
      owner.playVideo?.();
    } catch (e) {
      DEBUG && console.warn('[VideoQuality] Kick attempt failed:', e);
    }
    if (!isCurrentSession(owner, generation)) return;
    if (++attempts < 10) qualityTimeout(attempt, 500);
    else kickstartInProgress = false;
  };
  attempt();
}

function isQualityAlreadyMax() {
  if (!player) return false;
  try {
    const currentQuality = player.getPlaybackQuality?.();
    return TARGET_QUALITIES.has(currentQuality);
  } catch {
    return false;
  }
}

function setLocalStorageQuality() {
  if (!isForceEnabled()) return false;

  const now = Date.now();
  if (now - lastWriteTime < 2000) return false;

  if (cachedQualitySettings && cachedQualitySettings.quality === 4320) {
    return false;
  }

  try {
    if (!cachedQualitySettings) {
      const stored = window.localStorage.getItem(QUALITY_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.data) {
            cachedQualitySettings = JSON.parse(parsed.data);
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (
      cachedQualitySettings &&
      cachedQualitySettings.quality === 4320 &&
      cachedQualitySettings.previousQuality === 4320
    ) {
      return false;
    }

    const innerData = { quality: 4320, previousQuality: 4320 };

    const qualityObj = {
      data: JSON.stringify(innerData),
      creation: now,
      expiration: now + ONE_YEAR_MS
    };

    window.localStorage.setItem(QUALITY_KEY, JSON.stringify(qualityObj));
    cachedQualitySettings = innerData;
    lastWriteTime = now;

    DEBUG && console.info('[VideoQuality] Set localStorage quality to 4320p');
    return true;
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Failed to set localStorage quality:', e);
    return false;
  }
}

function setQualityOnPlayer() {
  if (!player || !isForceEnabled() || isDestroyed) {
    return { success: false, upgraded: false };
  }

  const owner = player;
  const generation = session;
  try {
    if (!owner.setPlaybackQualityRange) {
      return { success: false, upgraded: false };
    }

    if (isQualityAlreadyMax()) {
      return { success: true, upgraded: false };
    }

    DEBUG && console.log('[VideoQuality] Upgrading quality from:', owner.getPlaybackQuality?.());

    owner.setPlaybackQualityRange('highres', 'highres');
    if (!isCurrentSession(owner, generation)) return { success: false, upgraded: false };
    owner.setPlaybackQuality?.('highres');
    if (!isCurrentSession(owner, generation)) return { success: false, upgraded: false };

    const afterQuality = owner.getPlaybackQuality?.();
    const qualityLabel = owner.getPlaybackQualityLabel?.();

    DEBUG && console.info('[VideoQuality] ✅ Quality upgraded to:', afterQuality, qualityLabel);

    return {
      success: true,
      upgraded: true,
      newQuality: qualityLabel || afterQuality
    };
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error setting quality:', e);
    return { success: false, upgraded: false };
  }
}

function notifyIfUpgraded(result) {
  if (result && result.upgraded) {
    qualityTimeout(() => {
      try {
        const finalQuality =
          player.getPlaybackQualityLabel?.() || result.newQuality || 'high quality';
        showNotification(`Video quality upgraded to ${finalQuality}`);
        DEBUG && console.info('[VideoQuality] Notification shown:', finalQuality);
      } catch {
        showNotification('Video quality upgraded to high quality');
      }
    }, 500);
  }
}

function interceptAndUpgradeQuality(videoId) {
  if (!player || !isForceEnabled() || isDestroyed) return;

  if (videoBeingProcessed === videoId) return;

  if (isQualityAlreadyMax()) {
    qualitySetForVideo.add(videoId);
    return;
  }

  videoBeingProcessed = videoId;
  DEBUG && console.info('[VideoQuality] 🛑 Intercepting playback to upgrade quality:', videoId);

  const owner = player;
  const generation = session;
  const currentState = owner.getPlayerState?.();
  const wasPlaying = currentState === STATE_PLAYING;

  try {
    if (wasPlaying) {
      pausedForUpgrade = owner;
      owner.pauseVideo?.();
    }
  } catch {
    /* ignore */
  }

  if (!isCurrentSession(owner, generation)) return;
  qualityFrame(() => {
    const result = setQualityOnPlayer();
    if (!isCurrentSession(owner, generation)) return;

    if (result.success) {
      qualitySetForVideo.add(videoId);
    }

    qualityFrame(() => {
      if (wasPlaying) {
        try {
          owner.playVideo?.();
        } catch {
          /* ignore */
        }
      }
      if (!isCurrentSession(owner, generation)) return;
      pausedForUpgrade = null;
      notifyIfUpgraded(result);
      videoBeingProcessed = null;
    });
  });
}

function handleStateChange(state) {
  if (isDestroyed || !player?.isConnected || !isWatchPage() ||
      attachedHash !== window.location.hash) return;

  const actualState = state && state.data !== undefined ? state.data : state;

  let videoId;
  try {
    videoId = player.getVideoData?.()?.video_id;
  } catch {
    // State publication still works while YouTube replaces its video data.
  }
  const isNewVideo = videoId && videoId !== lastVideoId;
  if (isNewVideo) {
    cancelQualityWork();
    lastVideoId = videoId;
  }

  // Publish first. This event is shared infrastructure: watch.js (clock visibility) and
  // sponsorblock.js (overlay cache invalidation, observer re-arm, chain-skip re-arm) both
  // subscribe to it, so an unrelated quality setting must not suppress it.
  window.dispatchEvent(
    new CustomEvent('yt-player-state-change', {
      detail: { state: actualState, videoId: lastVideoId }
    })
  );

  // Everything below is quality forcing only.
  if (!_shouldForce) return;

  try {
    if (!videoId) return;
    if (isNewVideo && actualState === STATE_UNSTARTED) setLocalStorageQuality();

    if (qualitySetForVideo.has(videoId)) {
      if (actualState === STATE_PLAYING) ensurePlaybackStarts();
      return;
    }

    switch (actualState) {
      // Identical handling: setQualityOnPlayer() already short-circuits when the quality is
      // maxed, returning upgraded:false and making notifyIfUpgraded a no-op.
      case STATE_UNSTARTED:
      case STATE_BUFFERING:
        if (isNewVideo && player.getAvailableQualityLevels?.()?.length > 0) {
          if (!isQualityAlreadyMax()) notifyIfUpgraded(setQualityOnPlayer());
          qualitySetForVideo.add(videoId);
        }
        break;

      case STATE_PLAYING:
        if (!isQualityAlreadyMax()) {
          interceptAndUpgradeQuality(videoId);
        } else {
          qualitySetForVideo.add(videoId);
        }
        break;
    }

    ensurePlaybackStarts();
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error in state change handler:', e);
  }
}

function startStatePolling() {
  if (statePollingInterval) return;

  DEBUG && console.info('[VideoQuality] Starting state polling (Fallback)');

  statePollingInterval = setInterval(() => {
    if (isDestroyed || !player) {
      stopStatePolling();
      return;
    }
    try {
      const state = player.getPlayerState?.();
      if (state !== lastKnownState) {
        lastKnownState = state;
        handleStateChange(state);
      }
    } catch {
      /* ignore */
    }
  }, 250);
}

function stopStatePolling() {
  if (statePollingInterval) {
    clearInterval(statePollingInterval);
    statePollingInterval = null;
  }
}

export function destroyVideoQuality() {
  DEBUG && console.info('[VideoQuality] Destroying');

  isDestroyed = true;
  cancelQualityWork();

  if (initTimer) {
    clearTimeout(initTimer);
    initTimer = null;
  }

  stopStatePolling();

  if (player) {
    try {
      player.removeEventListener?.('onStateChange', stateListener);
    } catch {
      /* ignore */
    }
  }

  if (configCleanup) {
    try {
      configCleanup();
    } catch {
      /* ignore */
    }
  }

  player = null;
  attachedHash = null;
  stateListener = null;
  lastVideoId = null;
  lastKnownState = null;
  configCleanup = null;
  qualitySetForVideo.clear();
  videoBeingProcessed = null;
  _isWatchPageCached = false;
  kickstartInProgress = false;
  // Don't reset hasKickstarted here so it persists for the session
}

export function initVideoQuality() {
  if (!isWatchPage() || initTimer || player) return;

  DEBUG && console.info('[VideoQuality] Initializing');

  isDestroyed = false;
  _isWatchPageCached = true;
  attachedHash = window.location.hash;

  _shouldForce = configRead('forceHighResVideo');

  setLocalStorageQuality();

  const attach = () => {
    if (isDestroyed || !isWatchPage() || attachedHash !== window.location.hash) return true;

    const p = document.getElementById(SELECTORS.PLAYER_ID);

    if (!p || !p.setPlaybackQualityRange || !p.isConnected) {
      return false;
    }

    try {
      player = p;
      let listenerAttached = false;

      try {
        if (player.addEventListener) {
          const listener = state => {
            if (stateListener === listener && player === p && p.isConnected)
              handleStateChange(state);
          };
          stateListener = listener;
          player.addEventListener('onStateChange', listener);
          listenerAttached = true;
          DEBUG && console.log('[VideoQuality] Native listener attached');
        }
      } catch (e) {
        DEBUG && console.warn('[VideoQuality] Event listener failed, falling back to poll:', e);
      }

      if (!listenerAttached) {
        startStatePolling();
      }

      if (configAddChangeListener && !configCleanup) {
        const onChange = evt => {
          if (isDestroyed) return;
          const paused = pausedForUpgrade;
          const canResume = paused === player && paused?.isConnected &&
            attachedHash === window.location.hash;
          cancelQualityWork();
          _shouldForce = !!evt.detail.newValue;
          if (canResume) paused.playVideo?.();

          if (_shouldForce) {
            cachedQualitySettings = null;
            setLocalStorageQuality();
            qualitySetForVideo.clear();
          }
        };
        configCleanup =
          configAddChangeListener('forceHighResVideo', onChange) ||
          (() => configRemoveChangeListener?.('forceHighResVideo', onChange));
      }

      DEBUG && console.info('[VideoQuality] ✅ Attached to player');

      handleStateChange(player.getPlayerState?.());

      return true;
    } catch (e) {
      DEBUG && console.warn('[VideoQuality] Error attaching:', e);
      player = null;
      return false;
    }
  };

  if (attach()) return;

  let attempts = 0;
  const poll = () => {
    if (isDestroyed) {
      clearTimeout(initTimer);
      initTimer = null;
      return;
    }
    if (attach() || attempts++ >= 50) {
      clearTimeout(initTimer);
      initTimer = null;
    } else {
      initTimer = setTimeout(poll, 200);
    }
  };

  poll();
}

function handleNavigation() {
  const isWatch = isWatchPage();
  const nextPlayer = isWatch ? document.getElementById(SELECTORS.PLAYER_ID) : null;
  const replaced = attachedHash !== window.location.hash ||
    (player && (player !== nextPlayer || !player.isConnected));
  if (_isWatchPageCached && (!isWatch || replaced)) destroyVideoQuality();
  if (isWatch) initVideoQuality();
}

function setupListeners() {
  window.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);

  // Page-type updates also cover route transitions without a YouTube navigation event.
  window.addEventListener('ytaf-page-update', handleNavigation);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => handleNavigation());
  } else {
    handleNavigation();
  }

  window.addEventListener('beforeunload', destroyVideoQuality);
}

setupListeners();
