import { test } from 'node:test';
import assert from 'node:assert/strict';

const documentListeners = new Map();
const windowListeners = new Map();
const timers = new Map();
let nextTimer = 0;
const nodesById = new Map();
const descriptionFactoids = [];
const styles = [];

globalThis.window = {
  location: { hash: '#/watch?v=disabled-test' },
  returnYouTubeDislike: null,
  addEventListener(type, listener) { windowListeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (windowListeners.get(type) === listener) windowListeners.delete(type);
  },
  localStorage: { getItem() { return null; }, setItem() {} }
};
globalThis.location = { href: 'https://www.youtube.com/tv' };
globalThis.document = {
  readyState: 'complete',
  body: { appendChild() {}, classList: { contains() { return false; } } },
  head: { appendChild(node) { styles.push(node); } },
  addEventListener(type, listener) { documentListeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (documentListeners.get(type) === listener) documentListeners.delete(type);
  },
  getElementById(id) { return nodesById.get(id) || null; },
  querySelectorAll() { return [...descriptionFactoids]; },
  createElement(tagName) { return { tagName, id: '', textContent: '', remove() {} }; }
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextTimer;
  timers.set(id, { callback, delay });
  return id;
};
globalThis.clearTimeout = id => timers.delete(id);
globalThis.setInterval = () => ++nextTimer;
globalThis.clearInterval = () => {};

const { configWrite } = await import('../src/config.ts');
configWrite('enableReturnYouTubeDislike', false);
const { ReturnYouTubeDislike } = await import('../src/return-dislike.js');

test('counts-disabled Watch route creates no dislike handler or panel listeners', () => {
  windowListeners.get('hashchange')();

  assert.equal(globalThis.window.returnYouTubeDislike, null);
  assert.equal(documentListeners.has('focusin'), false);
  assert.equal(documentListeners.has('keydown'), false);
  assert.equal(documentListeners.has('focusout'), false);
});

test('focus detection binds the description panel without intercepting navigation', () => {
  const rowStyle = { marginTop: 'original', transform: 'original' };
  const panel = {
    nodeType: 1,
    tagName: 'YTLR-STRUCTURED-DESCRIPTION-CONTENT-RENDERER',
    parentNode: null,
    isConnected: true,
    style: rowStyle,
    querySelector() { return null; }
  };
  const focusedDescendant = { nodeType: 1, tagName: 'DIV', parentNode: panel };
  const ryd = new ReturnYouTubeDislike('focus-test');
  ryd.log = () => {};

  ryd.handleFocusIn({ target: focusedDescendant });

  assert.equal(ryd.panelElement, panel);
  assert.equal(documentListeners.has('focusin'), true);
  assert.equal(documentListeners.has('keydown'), false);
  assert.equal(documentListeners.has('focusout'), false);
  assert.deepEqual(rowStyle, { marginTop: 'original', transform: 'original' });

  const replacement = {
    ...panel,
    style: { marginTop: 'replacement', transform: 'replacement' }
  };
  const replacementDescendant = { nodeType: 1, tagName: 'DIV', parentNode: replacement };
  ryd.handleFocusIn({ target: replacementDescendant });
  assert.equal(ryd.panelElement, replacement, 'focus on the replacement rebinds while the old panel remains connected');

  ryd.destroy();
  assert.equal(documentListeners.has('focusin'), false);
  assert.equal(documentListeners.has('keydown'), false);
  assert.equal(documentListeners.has('focusout'), false);
});

test('an existing dislike row is recognized without additional DOM writes', () => {
  let classWrites = 0;
  let removals = 0;
  let geometryReads = 0;
  const value = {
    textContent: '\u2014',
    isConnected: true,
    getBoundingClientRect() { geometryReads++; throw new Error('rebinding measured layout'); }
  };
  const existing = {
    id: 'ryd-dislike-factoid',
    parentElement: { classList: { add() { classWrites++; } } },
    querySelector(selector) {
      return selector.includes('ytLrVideoDescriptionHeaderRendererValue') ? value : null;
    },
    setAttribute() {},
    remove() { removals++; }
  };
  const queries = [];
  const panel = { querySelector(selector) {
    queries.push(selector);
    return selector === '#ryd-dislike-factoid' ? existing : null;
  } };
  descriptionFactoids.push(existing);
  nodesById.set('ryd-dislike-factoid', existing);
  const ryd = new ReturnYouTubeDislike('existing-row');
  ryd.log = () => {};
  ryd.dislikesValue = 1534;

  ryd.checkAndInjectDislike(panel);

  assert.deepEqual(queries, ['#ryd-dislike-factoid']);
  assert.equal(ryd.dislikeFactoidElement, existing);
  assert.equal(ryd.dislikeValueElement, value);
  assert.equal(value.textContent, '1.5k');
  assert.equal(classWrites, 0);
  assert.equal(removals, 0);
  assert.equal(geometryReads, 0);
  ryd.destroy();
  nodesById.delete('ryd-dislike-factoid');
  descriptionFactoids.length = 0;
});

test('rapid reopen checks the new panel when the closing panel remains connected', () => {
  const stale = {
    id: 'ryd-dislike-factoid',
    parentElement: { classList: { add() {} } },
    querySelector() { return null; },
    setAttribute() {},
    removed: false,
    remove() { this.removed = true; }
  };
  descriptionFactoids.push(stale);
  const oldPanel = {
    nodeType: 1,
    tagName: 'YTLR-STRUCTURED-DESCRIPTION-CONTENT-RENDERER',
    isConnected: true,
    querySelector(selector) { return selector === '#ryd-dislike-factoid' ? stale : null; }
  };
  const queries = [];
  const newPanel = {
    nodeType: 1,
    tagName: 'YTLR-STRUCTURED-DESCRIPTION-CONTENT-RENDERER',
    isConnected: true,
    querySelector(selector) { queries.push(selector); return null; }
  };
  nodesById.set('ryd-dislike-factoid', stale); // Simulate the old globally visible row.
  const ryd = new ReturnYouTubeDislike('rapid-reopen');
  ryd.log = () => {};
  ryd.handleFocusIn({ target: { nodeType: 1, tagName: 'DIV', parentNode: oldPanel } });
  ryd.cachedMode = ryd.modeConfigs.compact;
  ryd.handleFocusIn({ target: { nodeType: 1, tagName: 'DIV', parentNode: newPanel } });

  assert.equal(ryd.panelElement, newPanel);
  assert.equal(ryd.cachedMode, null, 'the old panel mode is discarded before new-panel detection');
  assert.equal(queries[0], '#ryd-dislike-factoid');
  assert.notEqual(queries[0], undefined, 'the new panel is checked despite the old global row');
  ryd.destroy();
  assert.equal(stale.removed, true, 'destroy removes stale factoids from description panels');
  descriptionFactoids.length = 0;
  nodesById.delete('ryd-dislike-factoid');
});

test('count updates change only the dislike value and label without layout reads', () => {
  let geometryReads = 0;
  const value = {
    textContent: '\u2014',
    isConnected: true,
    getBoundingClientRect() { geometryReads++; throw new Error('count update measured layout'); }
  };
  const dislikeRow = {
    ariaLabel: '\u2014 Dislikes',
    setAttribute(name, text) { if (name === 'aria-label') this.ariaLabel = text; },
    getBoundingClientRect() { geometryReads++; throw new Error('count update measured layout'); }
  };
  const views = { textContent: '1.2M views' };
  const date = { textContent: '2 years ago' };
  const rows = [views, date, dislikeRow];
  const ryd = new ReturnYouTubeDislike('count-test');
  ryd.dislikeValueElement = value;
  ryd.dislikeFactoidElement = dislikeRow;
  ryd.dislikesValue = 1534;

  ryd.updateDislikeDisplay();

  assert.equal(value.textContent, '1.5k');
  assert.equal(dislikeRow.ariaLabel, '1.5k Dislikes');
  assert.deepEqual(rows, [views, date, dislikeRow]);
  assert.equal(views.textContent, '1.2M views');
  assert.equal(date.textContent, '2 years ago');
  assert.equal(geometryReads, 0);
  ryd.destroy();
});
