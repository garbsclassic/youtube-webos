import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce, waitForChildAdd } from '../src/utils.js';
import { SponsorBlockHandler } from '../src/sponsorblock.js';
import { ReturnYouTubeDislike } from '../src/return-dislike.js';
import { configWrite } from '../src/config.ts';
import {
  cleanup as cleanupThumbnails,
  setThumbnailDiagnostics,
  upgradeResponseThumbnails
} from '../src/thumbnail-quality.js';

test('cancelled debounce does not call its target', async () => {
  let calls = 0;
  const run = debounce(() => calls++, 10);
  run();
  run.cancel();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 0);
});

test('waitForChildAdd rejects an already-aborted signal before observing', async () => {
  let observeCalls = 0;
  globalThis.MutationObserver = class {
    observe() { observeCalls++; }
    disconnect() {}
  };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    waitForChildAdd({}, () => false, false, controller.signal, 100),
    /aborted/
  );
  assert.equal(observeCalls, 0);
});

test('SponsorBlock geometry is independent of timeupdate handling', () => {
  const handler = Object.create(SponsorBlockHandler.prototype);
  Object.assign(handler, {
    isSkipping: false,
    overlay: {},
    progressBar: {},
    skipSegments: [],
    video: { paused: false, currentTime: 1, seeking: false, readyState: 4 },
    toggleTimeListener() {},
    scheduleOverlaySync() { throw new Error('timeupdate scheduled overlay layout'); }
  });

  assert.doesNotThrow(() => handler.handleTimeUpdate());
});

test('SponsorBlock stops boundary polling when the document is hidden', () => {
  const oldHidden = globalThis.document;
  const oldCancel = globalThis.cancelAnimationFrame;
  let canceled = null;
  globalThis.document = { hidden: true };
  globalThis.cancelAnimationFrame = id => { canceled = id; };
  const handler = Object.create(SponsorBlockHandler.prototype);
  Object.assign(handler, {
    isDestroyed: false,
    video: { paused: false },
    isSkipping: false,
    pollingRafId: 42
  });

  try {
    handler.highFreqLoop();
    assert.equal(canceled, 42);
    assert.equal(handler.pollingRafId, null);
  } finally {
    globalThis.document = oldHidden;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('SponsorBlock ends boundary polling after media time stops advancing', () => {
  const oldDocument = globalThis.document;
  const oldPerformance = globalThis.performance;
  const oldRequest = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  let now = 100;
  let callback;
  let cancelled = null;
  globalThis.document = { hidden: false };
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = cb => { callback = cb; return 7; };
  globalThis.cancelAnimationFrame = id => { cancelled = id; };
  const handler = Object.create(SponsorBlockHandler.prototype);
  Object.assign(handler, {
    isDestroyed: false,
    video: { paused: false, currentTime: 10, readyState: 4 },
    isSkipping: false,
    pollingRafId: 6,
    nextSegmentStart: 11,
    _pollMediaTime: 10,
    _pollProgressAt: 100,
    boundHighFreqLoop: null
  });
  handler.boundHighFreqLoop = handler.highFreqLoop.bind(handler);

  try {
    handler.highFreqLoop();
    assert.equal(handler.pollingRafId, 7);
    now = 351;
    callback();
    assert.equal(cancelled, 7);
    assert.equal(handler.pollingRafId, null);
  } finally {
    globalThis.document = oldDocument;
    globalThis.performance = oldPerformance;
    globalThis.requestAnimationFrame = oldRequest;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('SponsorBlock ignores a response body that finishes after destruction', async () => {
  const oldFetch = globalThis.fetch;
  let finishBody;
  let bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  globalThis.fetch = async () => ({
    ok: true,
    json: () => new Promise(resolve => { finishBody = resolve; bodyStarted(); })
  });
  const handler = Object.create(SponsorBlockHandler.prototype);
  Object.assign(handler, {
    isDestroyed: false,
    abortController: null,
    log() {}
  });

  try {
    const result = handler.fetchSegments('abcdef');
    await started;
    handler.isDestroyed = true;
    finishBody([{ videoID: 'video', segments: [] }]);
    assert.equal(await result, null);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('SponsorBlock aborts a request when reading its response body times out', async () => {
  const oldFetch = globalThis.fetch;
  const oldSetTimeout = globalThis.setTimeout;
  let calls = 0;
  const signals = [];
  globalThis.fetch = async (_url, options) => {
    calls++;
    signals.push(options.signal);
    return { ok: true, json: () => new Promise(() => {}) };
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 5000) {
      queueMicrotask(() => callback(...args));
      return 5000;
    }
    return oldSetTimeout(callback, delay, ...args);
  };
  const handler = Object.create(SponsorBlockHandler.prototype);
  Object.assign(handler, { isDestroyed: false, abortController: null, log() {} });

  try {
    assert.equal(await handler.fetchSegments('abcdef'), null);
    assert.equal(calls, 2);
    assert.deepEqual(signals.map(signal => signal.aborted), [true, true]);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldSetTimeout;
  }
});

test('Return YouTube Dislike aborts a timed-out response body and releases its owner', async () => {
  const oldFetch = globalThis.fetch;
  const oldSetTimeout = globalThis.setTimeout;
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; }
  };
  globalThis.window = { removeEventListener() {} };
  let signal;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 8000) {
      queueMicrotask(() => callback(...args));
      return 8000;
    }
    return oldSetTimeout(callback, delay, ...args);
  };
  const ryd = new ReturnYouTubeDislike('resource-test-video');
  ryd.log = () => {};

  try {
    await ryd.fetchVideoData();
    assert.equal(signal.aborted, true);
    assert.equal(ryd.fetchRequest, null);
    assert.equal(ryd.abortController, null);
    assert.equal(ryd.dislikesValue, null);
  } finally {
    ryd.destroy();
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldSetTimeout;
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  }
});

test('recognized no-op thumbnail structures skip the generic response scan', () => {
  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  const data = {
    contents: { sectionListRenderer: { contents: [{ gridRenderer: { items: [] } }] } }
  };
  Object.defineProperty(data, 'unexpected', {
    enumerable: true,
    get() { throw new Error('generic scan touched unrelated branch'); }
  });

  try {
    assert.equal(upgradeResponseThumbnails(data, 'SEARCH'), 0);
    assert.equal(diagnostics.calls, 0);
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }
});

test('unknown thumbnail response shapes still use the fallback scanner', () => {
  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  const data = {
    unfamiliarPayload: {
      thumbnails: [{ url: 'https://i.ytimg.com/vi/video123/mqdefault.jpg' }]
    }
  };

  try {
    assert.equal(upgradeResponseThumbnails(data, 'UNKNOWN'), 1);
    assert.match(data.unfamiliarPayload.thumbnails[0].url, /hqdefault\.jpg$/);
    assert.equal(diagnostics.calls, 1);
    assert.ok(diagnostics.visited > 0);
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }
});

test('thumbnail schemas upgrade Home, Search, browse, Watch/Next, continuations, and actions', () => {
  const section = id => ({ videoRenderer: { thumbnail: {
    thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }]
  } } });
  const cases = [
    ['Home', 'HOME_BROWSE', {
      contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: {
        sectionListRenderer: { contents: [{ shelfRenderer: { content: {
          horizontalListRenderer: { items: [section('home123')] }
        } } }] }
      } } } } }
    }, 'home123'],
    ['Search', 'SEARCH', {
      contents: { sectionListRenderer: { contents: [section('search123')] } }
    }, 'search123'],
    ['browse tabs', 'BROWSE_TABS', {
      contents: { tvBrowseRenderer: { content: { tvSecondaryNavRenderer: { sections: [
        { tvSecondaryNavSectionRenderer: { tabs: [{ tabRenderer: { content: {
          sectionListRenderer: { contents: [section('browse123')] }
        } } }] } }
      ] } } } }
    }, 'browse123'],
    ['Watch/Next pivot', 'NEXT', {
      contents: { singleColumnWatchNextResults: { pivot: {
        sectionListRenderer: { contents: [section('watch123')] }
      } } }
    }, 'watch123'],
    ['section continuation', 'CONTINUATION', {
      continuationContents: { sectionListContinuation: { contents: [section('contsec123')] } }
    }, 'contsec123'],
    ['TV surface continuation', 'CONTINUATION', {
      continuationContents: { tvSurfaceContentContinuation: { content: {
        sectionListRenderer: { contents: [section('conttv123')] }
      } } }
    }, 'conttv123'],
    ['grid continuation', 'CONTINUATION', {
      continuationContents: { gridContinuation: { items: [section('contgrid123')] } }
    }, 'contgrid123'],
    ['horizontal continuation', 'CONTINUATION', {
      continuationContents: { horizontalListContinuation: { items: [section('conthoriz123')] } }
    }, 'conthoriz123'],
    ['action continuation', 'ACTION', {
      onResponseReceivedActions: [{ appendContinuationItemsAction: {
        continuationItems: [section('action123')]
      } }]
    }, 'action123']
  ];

  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  try {
    for (const [name, type, data, id] of cases) {
      assert.equal(upgradeResponseThumbnails(data, type), 1, `${name} rewrites one URL`);
      const upgradedUrl = findThumbnail(data).url;
      assert.match(upgradedUrl, /hqdefault\.jpg$/, name);
      assert.ok(upgradedUrl.includes(id), name);
    }
    assert.equal(diagnostics.calls, 0, 'known response shapes avoid the generic scan');
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }

  function findThumbnail(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value.thumbnails)) return value.thumbnails[0];
    for (const child of Object.values(value)) {
      const found = findThumbnail(child);
      if (found) return found;
    }
    return null;
  }
});

test('known continuation shapes also recover an unknown mixed branch', () => {
  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  const data = {
    continuationContents: {
      gridContinuation: { items: [{ videoRenderer: { thumbnail: {
        thumbnails: [{ url: 'https://i.ytimg.com/vi/known123/mqdefault.jpg' }]
      } } }] },
      unfamiliarContinuation: { nested: { thumbnails: [
        { url: 'https://i.ytimg.com/vi/recovery123/mqdefault.jpg' }
      ] } }
    }
  };

  try {
    assert.equal(upgradeResponseThumbnails(data, 'CONTINUATION'), 2);
    assert.match(data.continuationContents.gridContinuation.items[0].videoRenderer.thumbnail.thumbnails[0].url, /hqdefault\.jpg$/);
    assert.match(data.continuationContents.unfamiliarContinuation.nested.thumbnails[0].url, /hqdefault\.jpg$/);
    assert.equal(diagnostics.calls, 1);
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }
});

test('recognized already-optimal URLs do not trigger fallback traversal', () => {
  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  const data = { contents: { sectionListRenderer: { contents: [{
    videoRenderer: { thumbnail: { thumbnails: [
      { url: 'https://i.ytimg.com/vi/already123/hqdefault.jpg' }
    ] } }
  }] } } };
  Object.defineProperty(data, 'unrelated', {
    enumerable: true,
    get() { throw new Error('recognized response fell back to generic scan'); }
  });

  try {
    assert.equal(upgradeResponseThumbnails(data, 'SEARCH'), 0);
    assert.equal(diagnostics.calls, 0);
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }
});

test('wide unknown response fallback keeps its visit and queue budgets', () => {
  configWrite('upgradeThumbnails', true);
  const diagnostics = setThumbnailDiagnostics(true);
  const wide = Object.fromEntries(Array.from({ length: 7000 }, (_, i) => [`branch${i}`, {}]));

  try {
    upgradeResponseThumbnails({ unknown: wide }, 'UNKNOWN');
    assert.equal(diagnostics.calls, 1);
    assert.ok(diagnostics.visited <= 6000);
    assert.ok(diagnostics.enqueued <= 6000);
    assert.equal(diagnostics.capped, 1);
  } finally {
    setThumbnailDiagnostics(false);
    cleanupThumbnails();
    configWrite('upgradeThumbnails', false);
  }
});

test('video quality does not attach or poll on a non-Watch route', async () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldSetInterval = globalThis.setInterval;
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancelRaf = globalThis.cancelAnimationFrame;
  let intervalCalls = 0;
  const listeners = new Map();
  let playerLookups = 0;
  globalThis.window = {
    navigator: { userAgent: 'webOS.TV-2025' },
    location: { hash: '#/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener() {},
    dispatchEvent() {}
  };
  globalThis.document = {
    body: { classList: { contains() { return false; } } },
    readyState: 'complete',
    getElementById() { playerLookups++; return null; }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'webOS.TV-2025' }
  });
  globalThis.setInterval = (...args) => { intervalCalls++; return oldSetInterval(...args); };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  try {
    const mod = await import(`../src/video-quality.js?home=${Date.now()}`);
    mod.initVideoQuality();
    assert.equal(playerLookups, 0);
    assert.equal(intervalCalls, 0);
    assert.ok(listeners.has('ytaf-page-update'));
    mod.destroyVideoQuality();
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    globalThis.setInterval = oldSetInterval;
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancelRaf;
  }
});
