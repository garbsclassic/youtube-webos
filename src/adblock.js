import { configGetAll, configAddChangeListener } from './config';
import { isShortsPage } from './utils';
import { FetchRegistry } from './hooks';

const DEBUG = false;
const FORCE_FALLBACK = false;

// One flag per hook. A single flag meant a throwing fetch addEventListener still marked
// everything hooked, and destroyTrackingBlock cleared it from the XHR branch's finally.
let isFetchHooked = false;
let isXHRHooked = false;
let originalXHROpen = null;
let originalXHRSend = null;

// --- CONSTANTS & CONFIGURATION ---

// Single source of truth — TELEMETRY_REGEX is derived from this list.
// '/api/stats/watchtime' intentionally omitted (affects watch time statistics).
const BLOCKED_TELEMETRY_PATHS = [
  '/youtubei/v1/log_event',
  '/ptracking',
  '/api/stats/atr',
  '/api/stats/qoe',
  '/pagead/',
  '/eligibility_check'
];

const TELEMETRY_REGEX = new RegExp(
  BLOCKED_TELEMETRY_PATHS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
);

const UI_STRINGS = {
  SHORTS_TITLE: 'Shorts',
  TOP_LIVE_GAMES_TITLE: 'Top live games',
  MOST_RELEVANT_TITLE: 'Most relevant',
  GUEST_PROMPT_TEXT: 'Sign in for better recommendations'
};

const YT_CONSTANTS = {
  SHELF_TYPE_SHORTS: 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS',
  TILE_STYLE_SHORTS: 'TILE_STYLE_YTLR_SHORTS',
  CONTENT_TYPE_SHORTS: 'TILE_CONTENT_TYPE_SHORTS',
  VIDEO_TYPE_REEL_AD: 'REEL_VIDEO_TYPE_AD'
};

const CONFIG_KEYS = {
  ADBLOCK: 'enableAdBlock',
  TRACKING: 'enableTrackingBlock',
  SHORTS: 'removeGlobalShorts',
  LIVE_GAMES: 'removeTopLiveGames',
  MOST_RELEVANT: 'removeMostRelevant',
  GUEST_PROMPTS: 'hideGuestSignInPrompts',
  ENDCARDS: 'hideEndcards'
};

const IGNORE_ON_SHORTS = new Set(['SEARCH', 'PLAYER', 'ACTION']);

// Snapshot of config — configGetAll() returns the live reference, so this only
// needs to be re-bound when the module loads. Flags below are recomputed on
// change to avoid 8 boolean ORs per request.
const cfgSnapshot = configGetAll();
let anyFilterEnabled = false;
let cfgNeedsContentFiltering = false;

// Singleton passed to filter functions — refreshed by recomputeFilterFlags()
// rather than re-allocated on every JSON.parse.
const cfgFlags = {
  enableAdBlock: false,
  enableTrackingBlock: false,
  removeGlobalShorts: false,
  removeTopLiveGames: false,
  removeMostRelevant: false,
  hideGuestPrompts: false,
  hideEndcards: false
};

function recomputeFilterFlags() {
  cfgNeedsContentFiltering = !!(
    cfgSnapshot[CONFIG_KEYS.ADBLOCK] || cfgSnapshot[CONFIG_KEYS.GUEST_PROMPTS]
  );

  cfgFlags.enableAdBlock = !!cfgSnapshot[CONFIG_KEYS.ADBLOCK];
  cfgFlags.enableTrackingBlock = !!cfgSnapshot[CONFIG_KEYS.TRACKING];
  cfgFlags.removeGlobalShorts = !!cfgSnapshot[CONFIG_KEYS.SHORTS];
  cfgFlags.removeTopLiveGames = !!cfgSnapshot[CONFIG_KEYS.LIVE_GAMES];
  cfgFlags.removeMostRelevant = !!cfgSnapshot[CONFIG_KEYS.MOST_RELEVANT];
  cfgFlags.hideGuestPrompts = !!cfgSnapshot[CONFIG_KEYS.GUEST_PROMPTS];
  cfgFlags.hideEndcards = !!cfgSnapshot[CONFIG_KEYS.ENDCARDS];

  anyFilterEnabled = !!(
    cfgFlags.enableAdBlock ||
    cfgFlags.enableTrackingBlock ||
    cfgFlags.removeGlobalShorts ||
    cfgFlags.removeTopLiveGames ||
    cfgFlags.removeMostRelevant ||
    cfgFlags.hideGuestPrompts ||
    cfgFlags.hideEndcards
  );
}

recomputeFilterFlags();
for (const k of Object.values(CONFIG_KEYS)) {
  configAddChangeListener(k, recomputeFilterFlags);
}

const SCHEMA_REGISTRY = {
  typeSignatures: [
    {
      type: 'SHORTS_SEQUENCE',
      detectionPath: ['entries'],
      matchFn: data => Array.isArray(data.entries)
    },
    { type: 'PLAYER', detectionPath: ['streamingData'] },
    { type: 'NEXT', detectionPath: ['contents', 'singleColumnWatchNextResults'] },
    {
      type: 'HOME_BROWSE',
      detectionPath: ['contents', 'tvBrowseRenderer', 'content', 'tvSurfaceContentRenderer']
    },
    {
      type: 'BROWSE_TABS',
      detectionPath: ['contents', 'tvBrowseRenderer', 'content', 'tvSecondaryNavRenderer']
    },
    {
      type: 'SEARCH',
      detectionPath: ['contents', 'sectionListRenderer'],
      excludePath: ['contents', 'tvBrowseRenderer']
    },
    { type: 'CONTINUATION', detectionPath: ['continuationContents'] },
    { type: 'ACTION', detectionPath: ['onResponseReceivedActions'] },
    { type: 'ACTION', detectionPath: ['onResponseReceivedEndpoints'] }
  ],
  paths: {
    PLAYER: { overlayPath: ['playerOverlays', 'playerOverlayRenderer'] },
    NEXT: {
      overlayPath: ['playerOverlays', 'playerOverlayRenderer'],
      pivotPath: [
        'contents',
        'singleColumnWatchNextResults',
        'pivot',
        'sectionListRenderer',
        'contents'
      ]
    },
    SHORTS_SEQUENCE: { listPath: ['entries'] },
    HOME_BROWSE: {
      mainContent: [
        'contents',
        'tvBrowseRenderer',
        'content',
        'tvSurfaceContentRenderer',
        'content',
        'sectionListRenderer',
        'contents'
      ]
    },
    BROWSE_TABS: {
      tabsPath: [
        'contents',
        'tvBrowseRenderer',
        'content',
        'tvSecondaryNavRenderer',
        'sections',
        '0',
        'tvSecondaryNavSectionRenderer',
        'tabs'
      ]
    },
    SEARCH: { mainContent: ['contents', 'sectionListRenderer', 'contents'] },
    CONTINUATION: {
      sectionPath: ['continuationContents', 'sectionListContinuation', 'contents'],
      gridPath: ['continuationContents', 'gridContinuation', 'items'],
      horizontalPath: ['continuationContents', 'horizontalListContinuation', 'items'],
      tvSurfacePath: [
        'continuationContents',
        'tvSurfaceContentContinuation',
        'content',
        'sectionListRenderer',
        'contents'
      ]
    }
  }
};

let origParse = JSON.parse;
let isHooked = false;

// --- CORE FUNCTIONS ---

function debugLog(msg, ...args) {
  if (DEBUG) console.log(`[AdBlock] ${msg}`, ...args);
}

// Depth-limited walk that strips trackingParams from every node.
function walkAndProcess(obj, maxDepth, currentDepth = 0) {
  if (!obj || typeof obj !== 'object' || currentDepth > maxDepth) return;

  if (typeof obj.trackingParams === 'string') obj.trackingParams = '';
  // NOTE: do NOT strip clickTrackingParams here -- that breaks clicking endcards.

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (v && typeof v === 'object') walkAndProcess(v, maxDepth, currentDepth + 1);
    }
  } else {
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object') walkAndProcess(v, maxDepth, currentDepth + 1);
    }
  }
}

const telemetryFetchHandler = evt => {
  const { url } = evt.detail;
  // url.pathname avoids the .href getter rebuilding the full URL string,
  // and is sufficient since all BLOCKED_TELEMETRY_PATHS are path-only.
  if (TELEMETRY_REGEX.test(url.pathname)) {
    if (DEBUG) console.info('[AdBlock] Blocked telemetry Fetch request:', url.pathname);
    evt.preventDefault();
  }
};

export function initTrackingBlock() {
  if (isFetchHooked || isXHRHooked) return;

  // 1. Hook Fetch (Wrapped separately so webOS 3 EventTarget failures don't break XHR)
  try {
    if (typeof FetchRegistry !== 'undefined' && FetchRegistry.getInstance) {
      FetchRegistry.getInstance().addEventListener('request', telemetryFetchHandler);
      isFetchHooked = true; // set here -- nothing between this and add() can throw
    }
  } catch (e) {
    console.warn('[AdBlock] Fetch hook failed (expected behavior on webOS 3):', e.message);
  }

  // 2. Hook XMLHttpRequest
  try {
    originalXHROpen = window.XMLHttpRequest.prototype.open;
    originalXHRSend = window.XMLHttpRequest.prototype.send;

    // The block decision belongs in open(): by send() the request is already configured,
    // and the old path could only abort it after the fact.
    window.XMLHttpRequest.prototype.open = function (method, url) {
      const urlStr = typeof url === 'string' ? url : url && url.toString ? url.toString() : '';
      this.__adblockBlocked = !!urlStr && TELEMETRY_REGEX.test(urlStr);

      if (this.__adblockBlocked) {
        if (DEBUG) console.info('[AdBlock] Blocked telemetry XHR request:', urlStr);
        // Re-point at an empty data: URL rather than aborting. The request resolves
        // normally with an empty 200 body, so YouTube's telemetry queue settles instead
        // of treating the abort as a failure worth retrying.
        const isAsync = arguments.length > 2 ? arguments[2] : true;
        return originalXHROpen.call(this, 'GET', 'data:text/plain,', isAsync);
      }

      return originalXHROpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function (_body) {
      if (this.__adblockBlocked) {
        return originalXHRSend.call(this); // drop the telemetry body
      }
      return originalXHRSend.apply(this, arguments);
    };

    isXHRHooked = true;
    console.info('[AdBlock] Telemetry network hooks enabled (XHR)');
  } catch (e) {
    console.error('[AdBlock] Failed to initialize XHR telemetry blockers:', e);
  }
}

export function destroyTrackingBlock() {
  if (!isFetchHooked && !isXHRHooked) return;

  // 1. Unhook Fetch
  if (isFetchHooked) {
    try {
      if (typeof FetchRegistry !== 'undefined' && FetchRegistry.getInstance) {
        FetchRegistry.getInstance().removeEventListener('request', telemetryFetchHandler);
      }
    } catch (e) {
      console.warn('[AdBlock] Fetch unhook failed (expected on older engines):', e.message);
    } finally {
      isFetchHooked = false;
    }
  }

  // 2. Unhook XMLHttpRequest
  if (isXHRHooked) {
    try {
      if (originalXHROpen && originalXHRSend) {
        window.XMLHttpRequest.prototype.open = originalXHROpen;
        window.XMLHttpRequest.prototype.send = originalXHRSend;
        originalXHROpen = null;
        originalXHRSend = null;
      }
    } catch (e) {
      console.error('[AdBlock] Failed to remove XHR network blockers:', e);
    } finally {
      isXHRHooked = false;
      if (DEBUG) console.info('[AdBlock] Telemetry network hooks disabled');
    }
  }
}

function logSchemaMiss(data, textLength) {
  try {
    let info = '';
    const keys = Array.isArray(data) ? '[Array]' : Object.keys(data);
    if (textLength < 1000) {
      info = `Content: ${JSON.stringify(data)}`;
    } else {
      info = `Top-Level Keys: [${Array.isArray(keys) ? keys.join(', ') : 'Array'}]`;
    }
    debugLog(`MISS (Fallback used) | Size: ${textLength} | ${info}`);
  } catch {
    debugLog(`MISS (Fallback used) | Size: ${textLength} | Error analyzing structure`);
  }
}

function hookedParse(text, reviver) {
  // Guards ordered cheapest-first. YouTube parses thousands of small blobs (localStorage
  // reads, config, per-tile metadata) and none of them can be a filterable response, so
  // those calls must cost as close to nothing as possible on top of the native parse.
  if (!anyFilterEnabled || !text || text.length < 500) {
    return origParse.call(this, text, reviver);
  }

  const data = origParse.call(this, text, reviver);
  if (!data || typeof data !== 'object') return data;
  // Three root-property checks in place of a regex over the whole payload string. This
  // deliberately narrows the match: a needle buried deep in an unrelated blob no longer
  // drags it through the filters.
  if (
    data.responseContext === undefined &&
    data.playerResponse === undefined &&
    data.continuationContents === undefined
  ) {
    return data;
  }
  if (data.botguardData) return data;

  try {
    const responseType = detectResponseType(data);
    const needsContentFiltering = cfgNeedsContentFiltering;

    if (isShortsPage() && responseType && IGNORE_ON_SHORTS.has(responseType)) return data;

    if (FORCE_FALLBACK) {
      if (DEBUG) debugLog('FORCE_FALLBACK active. Using fallback filters.');
      if (!Array.isArray(data)) applyFallbackFilters(data, cfgFlags, needsContentFiltering);
    } else if (responseType && SCHEMA_REGISTRY.paths[responseType]) {
      if (DEBUG) debugLog(`Schema Match: [${responseType}]`);
      applySchemaFilters(data, responseType, cfgFlags, needsContentFiltering);
    } else if (responseType === 'ACTION' || responseType === 'PLAYER') {
      if (DEBUG) debugLog(`Schema Match: [${responseType}]`);
      applySchemaFilters(data, responseType, cfgFlags, needsContentFiltering);
    } else if (text.length > 10000 && !Array.isArray(data)) {
      if (DEBUG) logSchemaMiss(data, text.length);
      applyFallbackFilters(data, cfgFlags, needsContentFiltering);
    }

    if (cfgFlags.enableTrackingBlock) {
      walkAndProcess(data, 15);
      if (DEBUG) debugLog('Stripped trackingParams globally');
    }
  } catch (e) {
    if (DEBUG) console.error('[AdBlock] Error during filtering:', e);
  }
  return data;
}

export function detectResponseType(data) {
  const signatures = SCHEMA_REGISTRY.typeSignatures;
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    if (sig.excludePath && getByPath(data, sig.excludePath) !== undefined) continue;
    if (getByPath(data, sig.detectionPath) !== undefined) {
      if (sig.matchFn && !sig.matchFn(data)) continue;
      return sig.type;
    }
  }
  return null;
}

function applySchemaFilters(data, responseType, config, needsContentFiltering) {
  const schema = SCHEMA_REGISTRY.paths[responseType];
  switch (responseType) {
    case 'SHORTS_SEQUENCE':
      if (config.enableAdBlock && schema?.listPath) {
        const entries = getByPath(data, schema.listPath);
        if (Array.isArray(entries)) {
          const oldLen = entries.length;
          filterItemsOptimized(entries, config, needsContentFiltering);
          if (DEBUG && entries.length !== oldLen)
            debugLog(`SHORTS_SEQUENCE: Removed ${oldLen - entries.length} items`);
        }
      }
      break;
    case 'HOME_BROWSE':
      if (schema?.mainContent) {
        let contents = getByPath(data, schema.mainContent);
        if (!contents) {
          contents = findObjects(data, ['sectionListRenderer'], 8).sectionListRenderer?.contents;
          if (DEBUG && contents) debugLog(`${responseType}: Using fallback search`);
        }
        if (Array.isArray(contents))
          processSectionListOptimized(contents, config, needsContentFiltering, responseType);
      }
      break;
    case 'BROWSE_TABS':
      if (schema?.tabsPath) {
        const tabs = getByPath(data, schema.tabsPath);
        if (Array.isArray(tabs)) {
          for (let i = 0; i < tabs.length; i++) {
            const gridContents =
              tabs[i].tabRenderer?.content?.sectionListRenderer?.contents ||
              tabs[i].tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer
                ?.contents;
            if (Array.isArray(gridContents))
              processSectionListOptimized(
                gridContents,
                config,
                needsContentFiltering,
                'BROWSE_TAB_GENERIC'
              );
          }
        }
      }
      break;
    case 'SEARCH':
      if (schema?.mainContent) {
        let contents = getByPath(data, schema.mainContent);
        if (!contents) {
          contents = findObjects(data, ['sectionListRenderer'], 8).sectionListRenderer?.contents;
          if (DEBUG && contents) debugLog(`${responseType}: Using fallback search`);
        }
        if (Array.isArray(contents))
          processSectionListOptimized(contents, config, needsContentFiltering, responseType);
      }
      break;
    case 'CONTINUATION':
      if (schema?.sectionPath) {
        const secList = getByPath(data, schema.sectionPath);
        if (Array.isArray(secList))
          processSectionListOptimized(
            secList,
            config,
            needsContentFiltering,
            'CONTINUATION (Section)'
          );
      }
      if (schema?.tvSurfacePath) {
        const tvList = getByPath(data, schema.tvSurfacePath);
        if (Array.isArray(tvList))
          processSectionListOptimized(
            tvList,
            config,
            needsContentFiltering,
            'CONTINUATION (TV Surface)'
          );
      }
      if (schema?.gridPath) {
        const gridItems = getByPath(data, schema.gridPath);
        if (Array.isArray(gridItems)) {
          const oldLen = gridItems.length;
          filterItemsOptimized(gridItems, config, needsContentFiltering);
          if (DEBUG && oldLen !== gridItems.length)
            debugLog(`CONTINUATION (Grid): Removed ${oldLen - gridItems.length} items`);
        }
      }
      if (schema?.horizontalPath) {
        const horizItems = getByPath(data, schema.horizontalPath);
        if (Array.isArray(horizItems)) {
          const oldLen = horizItems.length;
          filterItemsOptimized(horizItems, config, needsContentFiltering);
          if (DEBUG && oldLen !== horizItems.length)
            debugLog(`CONTINUATION (Horizontal): Removed ${oldLen - horizItems.length} items`);
        }
      }
      break;
    case 'ACTION': {
      const actions = data.onResponseReceivedActions || data.onResponseReceivedEndpoints;
      if (Array.isArray(actions)) {
        processActions(actions, config, needsContentFiltering);
      }
      break;
    }
    case 'PLAYER':
    case 'NEXT':
      if (config.enableAdBlock) {
        if (responseType === 'PLAYER') removePlayerAdsOptimized(data);
        let overlay = getByPath(data, schema?.overlayPath);
        if (!overlay) {
          overlay = findObjects(data, ['playerOverlayRenderer'], 8).playerOverlayRenderer;
          if (DEBUG && overlay)
            debugLog(`${responseType}: Path failed, found overlay via fallback`);
        }
        if (overlay?.timelyActionRenderers) {
          delete overlay.timelyActionRenderers;
          if (DEBUG) debugLog(`${responseType}: Removed timelyActionRenderers (QR Code)`);
        }
      }
      if (config.hideEndcards) {
        removeEndcardsOptimized(data);
      }
      if (config.hideGuestPrompts) {
        let pivotContents = getByPath(data, schema?.pivotPath);
        if (!pivotContents) {
          pivotContents = findObjects(data, ['pivot'], 8).pivot?.sectionListRenderer?.contents;
          if (DEBUG && pivotContents) debugLog(`${responseType}: Found pivot via fallback search`);
        }
        if (Array.isArray(pivotContents))
          processSectionListOptimized(
            pivotContents,
            config,
            needsContentFiltering,
            `${responseType} (Pivot)`
          );
      }
      break;
  }
}

function applyFallbackFilters(data, config, needsContentFiltering) {
  if (config.enableAdBlock) removePlayerAdsOptimized(data);
  if (config.hideEndcards) removeEndcardsOptimized(data);
  const needles = [
    'playerOverlayRenderer',
    'pivot',
    'sectionListRenderer',
    'gridRenderer',
    'gridContinuation',
    'sectionListContinuation',
    'entries'
  ];
  const found = findObjects(data, needles, 10);

  if (config.enableAdBlock && found.playerOverlayRenderer?.timelyActionRenderers) {
    delete found.playerOverlayRenderer.timelyActionRenderers;
    if (DEBUG) debugLog('FALLBACK: Removed timelyActionRenderers');
  }
  if (Array.isArray(found.pivot?.sectionListRenderer?.contents))
    processSectionListOptimized(
      found.pivot.sectionListRenderer.contents,
      config,
      needsContentFiltering,
      'Fallback Pivot'
    );
  if (Array.isArray(found.sectionListRenderer?.contents))
    processSectionListOptimized(
      found.sectionListRenderer.contents,
      config,
      needsContentFiltering,
      'Fallback sectionListRenderer'
    );
  if (Array.isArray(found.sectionListContinuation?.contents))
    processSectionListOptimized(
      found.sectionListContinuation.contents,
      config,
      needsContentFiltering,
      'Fallback sectionListContinuation'
    );

  if (found.gridRenderer?.items) {
    const oldLen = found.gridRenderer.items.length;
    filterItemsOptimized(found.gridRenderer.items, config, needsContentFiltering);
    if (DEBUG && oldLen !== found.gridRenderer.items.length)
      debugLog(`FALLBACK (Grid): Removed ${oldLen - found.gridRenderer.items.length} items`);
  }
  if (found.gridContinuation?.items) {
    const oldLen = found.gridContinuation.items.length;
    filterItemsOptimized(found.gridContinuation.items, config, needsContentFiltering);
    if (DEBUG && oldLen !== found.gridContinuation.items.length)
      debugLog(
        `FALLBACK (Grid Continuation): Removed ${oldLen - found.gridContinuation.items.length} items`
      );
  }
  if (Array.isArray(found.entries)) {
    const oldLen = found.entries.length;
    filterItemsOptimized(found.entries, config, needsContentFiltering);
    if (DEBUG && oldLen !== found.entries.length)
      debugLog(`FALLBACK (Entries): Removed ${oldLen - found.entries.length} items`);
  }

  const actions = data.onResponseReceivedActions || data.onResponseReceivedEndpoints;
  processActions(actions, config, needsContentFiltering);
}

function processActions(actions, config, needsContentFiltering) {
  if (!Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.reloadContinuationItemsCommand?.continuationItems) {
      filterItemsOptimized(
        action.reloadContinuationItemsCommand.continuationItems,
        config,
        needsContentFiltering
      );
    }
    if (action.appendContinuationItemsAction?.continuationItems) {
      filterItemsOptimized(
        action.appendContinuationItemsAction.continuationItems,
        config,
        needsContentFiltering
      );
    }
  }
}

function getShelfTitleOptimized(shelf) {
  if (!shelf) return '';
  return (
    shelf.title?.runs?.[0]?.text ||
    shelf.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title?.runs?.[0]
      ?.text ||
    ''
  );
}

function isReelAd(item, enableAdBlock) {
  if (!enableAdBlock) return false;
  const endpoint = item.command?.reelWatchEndpoint;
  return (
    endpoint?.adClientParams?.isAd === true ||
    endpoint?.adClientParams?.isAd === 'true' ||
    endpoint?.videoType === YT_CONSTANTS.VIDEO_TYPE_REEL_AD
  );
}

function hasAdRenderer(item, enableAdBlock) {
  return enableAdBlock && (item.adSlotRenderer || item.tvMastheadRenderer);
}

function hasGuestPromptRenderer(item, hideGuestPrompts) {
  return hideGuestPrompts && (item.feedNudgeRenderer || item.alertWithActionsRenderer);
}

export function processSectionListOptimized(
  contents,
  config,
  needsContentFiltering,
  contextName = ''
) {
  if (!Array.isArray(contents) || contents.length === 0) return;
  const {
    enableAdBlock,
    removeGlobalShorts,
    removeTopLiveGames,
    removeMostRelevant,
    hideGuestPrompts
  } = config;
  const initialCount = contents.length;
  let writeIdx = 0;

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    let keepItem = true;

    if (item.shelfRenderer) {
      const shelf = item.shelfRenderer;
      if (removeGlobalShorts && shelf.tvhtml5ShelfRendererType === YT_CONSTANTS.SHELF_TYPE_SHORTS)
        keepItem = false;
      else if (removeGlobalShorts || removeTopLiveGames || removeMostRelevant) {
        const title = getShelfTitleOptimized(shelf);
        if (removeGlobalShorts && title === UI_STRINGS.SHORTS_TITLE) keepItem = false;
        else if (removeTopLiveGames && title === UI_STRINGS.TOP_LIVE_GAMES_TITLE) keepItem = false;
        else if (removeMostRelevant && title === UI_STRINGS.MOST_RELEVANT_TITLE) keepItem = false;
      }
      if (keepItem && shelf.content) {
        const horizItems = shelf.content.horizontalListRenderer?.items;
        const gridItems = shelf.content.gridRenderer?.items;
        if (horizItems) filterItemsOptimized(horizItems, config, needsContentFiltering);
        if (gridItems) filterItemsOptimized(gridItems, config, needsContentFiltering);

        // A shelf we emptied has to go with its items. Left in place it still has a title
        // and a content box, so the app renders the header plus a <ytlr-ghost-surface> of
        // skeleton tiles and waits forever for content that was already removed.
        // Guarded on the lists having existed: a shelf whose content uses some other
        // renderer was never filtered here and must not be judged empty.
        if ((horizItems || gridItems) && !horizItems?.length && !gridItems?.length) {
          keepItem = false;
          if (DEBUG)
            debugLog(
              `${contextName ? contextName + ': ' : ''}Dropped emptied shelf ` +
                `"${getShelfTitleOptimized(shelf)}"`
            );
        }
      }
    } else if (
      hasAdRenderer(item, enableAdBlock) ||
      hasGuestPromptRenderer(item, hideGuestPrompts) ||
      isReelAd(item, enableAdBlock)
    ) {
      keepItem = false;
    }

    if (keepItem) {
      if (writeIdx !== i) contents[writeIdx] = item;
      writeIdx++;
    }
  }
  contents.length = writeIdx;

  if (DEBUG) {
    const removed = initialCount - writeIdx;
    if (removed > 0)
      debugLog(
        `${contextName ? contextName + ': ' : ''}Filtered ${removed} top-level items from ${initialCount}`
      );
  }
}

function filterItemsOptimized(items, config, needsContentFiltering) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const { enableAdBlock, removeGlobalShorts, hideGuestPrompts } = config;
  if (!removeGlobalShorts && !needsContentFiltering) return items;

  let writeIdx = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let keep = true;

    if (needsContentFiltering) {
      if (
        hasAdRenderer(item, enableAdBlock) ||
        isReelAd(item, enableAdBlock) ||
        hasGuestPromptRenderer(item, hideGuestPrompts)
      )
        keep = false;
      else if (
        hideGuestPrompts &&
        item.gridButtonRenderer?.title?.runs?.[0]?.text === UI_STRINGS.GUEST_PROMPT_TEXT
      )
        keep = false;
    }

    if (keep && removeGlobalShorts) {
      const tile = item.tileRenderer;
      if (
        tile &&
        (tile.style === YT_CONSTANTS.TILE_STYLE_SHORTS ||
          tile.contentType === YT_CONSTANTS.CONTENT_TYPE_SHORTS ||
          tile.onSelectCommand?.reelWatchEndpoint)
      )
        keep = false;
      else if (
        item.reelItemRenderer ||
        item.contentType === YT_CONSTANTS.CONTENT_TYPE_SHORTS ||
        item.onSelectCommand?.reelWatchEndpoint
      )
        keep = false;
    }

    if (keep) {
      if (writeIdx !== i) items[writeIdx] = item;
      writeIdx++;
    }
  }
  items.length = writeIdx;
  return items;
}

export function getByPath(obj, parts) {
  if (!parts) return undefined;
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined;
    current = current[parts[i]];
  }
  return current;
}

function clearArrayIfExists(obj, key) {
  if (obj[key]?.length) {
    obj[key].length = 0;
    return 1;
  }
  return 0;
}

function removeEndcardsOptimized(data) {
  let cleared = 0;
  if (data.endscreen) {
    delete data.endscreen;
    cleared++;
  }
  if (data.playerResponse && data.playerResponse.endscreen) {
    delete data.playerResponse.endscreen;
    cleared++;
  }
  if (DEBUG && cleared > 0) debugLog('Cleaned Player Endcards');
}

function removePlayerAdsOptimized(data) {
  let cleared = 0;
  cleared += clearArrayIfExists(data, 'adPlacements');
  cleared += clearArrayIfExists(data, 'playerAds');
  cleared += clearArrayIfExists(data, 'adSlots');

  // Strip attestation and telemetry mismatches
  if (data.attestation) {
    delete data.attestation;
    cleared++;
    if (DEBUG) debugLog('Cleaned Player Attestation Challenge');
  }
  if (data.adBreakHeartbeatParams) {
    delete data.adBreakHeartbeatParams;
    cleared++;
    if (DEBUG) debugLog('Cleaned Ad Break Heartbeat');
  }
  if (data.playerResponse) {
    cleared += clearArrayIfExists(data.playerResponse, 'adPlacements');
    cleared += clearArrayIfExists(data.playerResponse, 'playerAds');
    cleared += clearArrayIfExists(data.playerResponse, 'adSlots');
  }
  if (DEBUG && cleared > 0) debugLog('Cleaned Player Ads/Placements');
}

export function findObjects(haystack, needlesArray, maxDepth = 10) {
  if (!haystack || typeof haystack !== 'object' || maxDepth <= 0 || !needlesArray.length) return {};
  const results = {};
  let foundCount = 0;
  const targetCount = needlesArray.length;
  // Flat queue to reduce GC pressure: [obj, depth, obj, depth, ...]
  const queue = [haystack, 0];
  let idx = 0;

  while (idx < queue.length && foundCount < targetCount) {
    const currentObj = queue[idx++];
    const currentDepth = queue[idx++];

    if (currentDepth > maxDepth) continue;

    for (let i = 0; i < targetCount; i++) {
      const needle = needlesArray[i];
      if (!results[needle] && currentObj[needle] !== undefined) {
        results[needle] = currentObj[needle];
        foundCount++;
      }
    }
    if (foundCount === targetCount) break;

    for (const k in currentObj) {
      const val = currentObj[k];
      if (val && typeof val === 'object') {
        queue.push(val, currentDepth + 1);
      }
    }
  }
  return results;
}

/**
 * The JSON.parse hook does more than ad filtering: it also drives guest-prompt hiding,
 * endcard hiding and trackingParams stripping, each of which has its own setting. Gating
 * the hook on enableAdBlock alone silently disabled all of them whenever Ad Blocking was
 * turned off.
 */
export function parseHookRequired() {
  return !!(
    cfgSnapshot[CONFIG_KEYS.ADBLOCK] ||
    cfgSnapshot[CONFIG_KEYS.GUEST_PROMPTS] ||
    cfgSnapshot[CONFIG_KEYS.ENDCARDS]
  );
}

/** Install or remove the JSON.parse hook to match the current settings. */
export function syncAdblockHook() {
  if (parseHookRequired()) initAdblock();
  else destroyAdblock();
}

export function initAdblock() {
  if (isHooked) return;
  if (DEBUG) console.info('[AdBlock] Initializing hybrid hook (Debug Mode: ' + DEBUG + ')');

  origParse = JSON.parse;
  // Assigned directly rather than wrapped in a forwarding closure: that wrapper added a
  // call frame to every JSON.parse in the app.
  JSON.parse = hookedParse;
  isHooked = true;
}

export function destroyAdblock() {
  if (!isHooked) return;
  if (DEBUG) console.info('[AdBlock] Restoring JSON.parse');

  JSON.parse = origParse;
  isHooked = false;
}

initAdblock();
