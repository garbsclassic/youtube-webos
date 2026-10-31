import { test } from 'node:test';
import assert from 'node:assert/strict';

const idleCallbacks = new Map();
const timers = new Map();
const xhrs = [];
let nextId = 0;
let renderedNodes = [];

class FakeXHR {
  open(method, url) { this.method = method; this.url = url; }
  send() { xhrs.push(this); }
  abort() { this.aborted = true; }
  getResponseHeader() { return this.contentLength || '10000'; }
  status = 200;
}

class FakeImage {
  set src(value) { this.url = value; imageRequests.push(value); }
}

const imageRequests = [];
globalThis.XMLHttpRequest = FakeXHR;
globalThis.Image = FakeImage;
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll() { return renderedNodes; }
};
globalThis.window = {
  localStorage: { getItem() { return null; }, setItem() {} },
  addEventListener() {},
  removeEventListener() {},
  requestIdleCallback(callback) {
    const id = ++nextId;
    idleCallbacks.set(id, callback);
    return id;
  },
  cancelIdleCallback(id) { idleCallbacks.delete(id); }
};
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextId;
  timers.set(id, { callback, delay });
  return id;
};
globalThis.clearTimeout = id => timers.delete(id);

const { configWrite } = await import('../src/config.ts');
const thumbs = await import('../src/thumbnail-quality.js');

function videoEntry(id, variant = 'mqdefault') {
  return { url: `https://i.ytimg.com/vi/${id}/${variant}.jpg` };
}

function searchPayload(entries) {
  return { contents: { sectionListRenderer: { contents: entries.map(thumbnail => ({
    videoRenderer: { thumbnail: { thumbnails: [thumbnail] } }
  })) } } };
}

function runNextIdle() {
  const [id, callback] = idleCallbacks.entries().next().value || [];
  assert.ok(callback, 'an idle probe pump is queued');
  idleCallbacks.delete(id);
  callback();
}

function cleanup() {
  configWrite('upgradeThumbnails', false);
  thumbs.cleanup();
  renderedNodes = [];
  xhrs.length = 0;
  imageRequests.length = 0;
  timers.clear();
  idleCallbacks.clear();
}

test('rendered tiles are probed in DOM order ahead of offscreen FIFO work', () => {
  configWrite('thumbnailQualityMode', 'safe');
  configWrite('upgradeThumbnails', true);
  const entries = Array.from({ length: 8 }, (_, i) => videoEntry(`order${i}`));
  renderedNodes = ['order6', 'order2'].map(id => ({
    style: { backgroundImage: `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")` },
    isConnected: true
  }));

  thumbs.upgradeResponseThumbnails(searchPayload(entries), 'SEARCH');
  runNextIdle();

  assert.deepEqual(imageRequests.map(url => url.match(/vi\/([^/]+)/)[1]), ['order6', 'order2']);
  assert.match(xhrs[0].url, /vi\/order0\//, 'offscreen work retains FIFO ordering');
  cleanup();
});

test('pending-model eviction corrects speculative eager URLs before release', () => {
  configWrite('thumbnailQualityMode', 'eager');
  configWrite('upgradeThumbnails', true);
  const entries = Array.from({ length: 1501 }, (_, i) => videoEntry(`evict${i}`));

  thumbs.upgradeResponseThumbnails(searchPayload(entries), 'SEARCH');

  assert.match(entries[0].url, /hqdefault\.jpg$/, 'the oldest released model entry is safe');
  assert.match(entries[1500].url, /maxresdefault\.jpg$/, 'the newest entry remains pending');
  cleanup();
});

test('an in-flight miss preserves a higher proof learned before model eviction', async () => {
  configWrite('thumbnailQualityMode', 'safe');
  configWrite('upgradeThumbnails', true);
  const proven = videoEntry('proof123', 'hq720');
  thumbs.upgradeResponseThumbnails(searchPayload([proven]), 'SEARCH');
  runNextIdle();
  const xhr = xhrs[0];
  assert.ok(xhr);
  const lateLoad = xhr.onload;

  const fill = Array.from({ length: 1500 }, (_, i) => videoEntry(`fill${i}`));
  thumbs.upgradeResponseThumbnails(searchPayload(fill), 'SEARCH');
  assert.match(proven.url, /hq720\.jpg$/);

  xhr.status = 404;
  lateLoad();
  await Promise.resolve();
  await Promise.resolve();

  const check = videoEntry('proof123', 'mqdefault');
  thumbs.upgradeResponseThumbnails(searchPayload([check]), 'SEARCH');
  assert.match(check.url, /hq720\.jpg$/, 'the miss cannot downgrade cached/model proof');
  cleanup();
});

test('entry ownership caps unique references and deduplicates repeated references', () => {
  configWrite('thumbnailQualityMode', 'eager');
  configWrite('upgradeThumbnails', true);
  const nineDistinct = Array.from({ length: 9 }, () => videoEntry('nine123'));
  thumbs.upgradeResponseThumbnails(searchPayload(nineDistinct), 'SEARCH');
  assert.match(nineDistinct[7].url, /maxresdefault\.jpg$/);
  assert.match(nineDistinct[8].url, /hqdefault\.jpg$/, 'an unowned ninth ref stays safe');
  cleanup();

  configWrite('thumbnailQualityMode', 'eager');
  configWrite('upgradeThumbnails', true);
  const eight = Array.from({ length: 8 }, (_, i) => videoEntry(`repeat${i}`));
  const repeated = [eight[0], ...eight.slice(1), eight[0]];
  thumbs.upgradeResponseThumbnails(searchPayload(repeated), 'SEARCH');
  assert.ok(repeated.every(entry => /maxresdefault\.jpg$/.test(entry.url)));
  cleanup();
});

test('eager entries after the attempt budget remain at a proven-safe quality', () => {
  configWrite('thumbnailQualityMode', 'eager');
  configWrite('upgradeThumbnails', true);
  const entries = Array.from({ length: 4001 }, (_, i) => videoEntry(`budget${i}`));

  thumbs.upgradeResponseThumbnails(searchPayload(entries), 'SEARCH');

  assert.match(entries[4000].url, /hqdefault\.jpg$/);
  cleanup();
});
