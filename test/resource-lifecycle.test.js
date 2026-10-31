import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeClock() {
  let nextId = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(callback, delay) {
      const id = ++nextId;
      jobs.set(id, { callback, delay, interval: false });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    setInterval(callback, delay) {
      const id = ++nextId;
      jobs.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) { jobs.delete(id); }
  };
}

function fakeElement() {
  return {
    isConnected: true,
    style: {},
    classList: { toggle() {} },
    setAttribute() {},
    remove() { this.isConnected = false; }
  };
}

test('disabling the clock before minute alignment prevents its interval', async () => {
  const timers = fakeClock();
  const oldTimers = Object.fromEntries(
    ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map(k => [k, globalThis[k]])
  );
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldObserver = globalThis.MutationObserver;
  const body = {
    appendChild() {},
    className: 'WEB_PAGE_TYPE_WATCH',
    classList: { contains(name) { return name === 'WEB_PAGE_TYPE_WATCH'; } }
  };
  globalThis.document = {
    body,
    activeElement: body,
    createElement: fakeElement,
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  globalThis.setTimeout = timers.setTimeout;
  globalThis.clearTimeout = timers.clearTimeout;
  globalThis.setInterval = timers.setInterval;
  globalThis.clearInterval = timers.clearInterval;

  try {
    const { configWrite } = await import('../src/config.ts');
    await import(`../src/watch.js?clock=${Date.now()}`);
    configWrite('showWatch', true);
    assert.ok([...timers.jobs.values()].some(job => !job.interval && job.delay > 1000));

    configWrite('showWatch', false);
    assert.equal([...timers.jobs.values()].some(job => job.interval), false);
    assert.equal([...timers.jobs.values()].some(job => !job.interval && job.delay > 1000), false);
  } finally {
    for (const [name, fn] of Object.entries(oldTimers)) globalThis[name] = fn;
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    globalThis.MutationObserver = oldObserver;
  }
});

test('a quality-upgrade frame from an old video cannot modify or resume it', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldObserver = globalThis.MutationObserver;
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancelRaf = globalThis.cancelAnimationFrame;
  const handlers = new Map();
  const frames = new Map();
  let nextFrame = 0;
  let currentPlayer;
  const body = {
    className: 'WEB_PAGE_TYPE_WATCH',
    classList: { contains(name) { return name === 'WEB_PAGE_TYPE_WATCH'; } }
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = {
    body,
    readyState: 'complete',
    getElementById() { return currentPlayer; },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    navigator: { userAgent: 'webOS.TV-2025' },
    location: { hash: '#/watch?v=first' },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
    dispatchEvent() {}
  };
  globalThis.requestAnimationFrame = callback => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};

  const createPlayer = () => ({
    isConnected: true,
    stateListener: null,
    pauses: 0,
    resumes: 0,
    qualityWrites: 0,
    addEventListener(_name, fn) { this.stateListener = fn; },
    removeEventListener() {},
    getPlayerState() { return 1; },
    getVideoData() { return { video_id: 'first' }; },
    getPlaybackQuality() { return 'auto'; },
    getAvailableQualityLevels() { return ['highres']; },
    setPlaybackQualityRange() { this.qualityWrites++; },
    setPlaybackQuality() { this.qualityWrites++; },
    pauseVideo() { this.pauses++; },
    playVideo() { this.resumes++; }
  });
  currentPlayer = createPlayer();

  try {
    const { configWrite } = await import('../src/config.ts');
    configWrite('forceHighResVideo', true);
    const quality = await import(`../src/video-quality.js?frames=${Date.now()}`);
    await new Promise(resolve => setImmediate(resolve));
    const staleFrame = [...frames.entries()].find(([, callback]) => callback);
    assert.ok(staleFrame, 'initial playback queues an upgrade frame');
    const oldPlayer = currentPlayer;
    assert.equal(oldPlayer.pauses, 1);

    currentPlayer = createPlayer();
    globalThis.window.location.hash = '#/watch?v=second';
    handlers.get('hashchange')();
    staleFrame[1]();

    assert.equal(oldPlayer.qualityWrites, 0);
    assert.equal(oldPlayer.resumes, 0);
    quality.destroyVideoQuality();
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    globalThis.MutationObserver = oldObserver;
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancelRaf;
  }
});

test('a thumbnail probe from before disable cannot alter a new session', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldXhr = globalThis.XMLHttpRequest;
  const idleCallbacks = new Map();
  const xhrs = [];
  let nextIdle = 0;
  class FakeXHR {
    open() {}
    send() { xhrs.push(this); }
    abort() { this.aborted = true; }
    getResponseHeader() { return '10000'; }
    status = 200;
  }
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; }
  };
  globalThis.window = {
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    removeEventListener() {},
    requestIdleCallback(callback) {
      const id = ++nextIdle;
      idleCallbacks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleCallbacks.delete(id); }
  };

  try {
    const { configWrite } = await import('../src/config.ts');
    const thumbs = await import(`../src/thumbnail-quality.js?session=${Date.now()}`);
    configWrite('thumbnailQualityMode', 'eager');
    configWrite('upgradeThumbnails', true);
    const first = { url: 'https://i.ytimg.com/vi/oldvideo/mqdefault.jpg' };
    thumbs.upgradeResponseThumbnails({ unknown: { thumbnails: [first] } }, 'UNKNOWN');
    idleCallbacks.values().next().value();
    const staleXhr = xhrs[0];
    assert.ok(staleXhr);
    const lateLoad = staleXhr.onload;
    assert.equal(typeof lateLoad, 'function');

    configWrite('upgradeThumbnails', false);
    assert.equal(staleXhr.aborted, true);
    assert.match(first.url, /hqdefault\.jpg$/);

    configWrite('upgradeThumbnails', true);
    const second = { url: 'https://i.ytimg.com/vi/newvideo/mqdefault.jpg' };
    thumbs.upgradeResponseThumbnails({ unknown: { thumbnails: [second] } }, 'UNKNOWN');
    const pendingIdle = [...idleCallbacks.values()].at(-1);
    pendingIdle();
    lateLoad();
    await Promise.resolve();
    await Promise.resolve();

    assert.match(first.url, /hqdefault\.jpg$/);
    assert.match(second.url, /maxresdefault\.jpg$/);
    assert.equal(xhrs.length, 2);
  } finally {
    const { cleanup, setThumbnailDiagnostics } = await import('../src/thumbnail-quality.js');
    cleanup();
    setThumbnailDiagnostics(false);
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    globalThis.XMLHttpRequest = oldXhr;
  }
});
