import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../src/spatial-navigation.js', import.meta.url)),
  'utf8'
).replace(/\nexport \{\};\s*$/, '\n');

class FakeElement {
  constructor(nodeName, rect = { left: 0, top: 0, width: 40, height: 40 }) {
    this.nodeName = nodeName;
    this.tagName = nodeName;
    this.parentElement = null;
    this.children = [];
    this.tabIndex = nodeName === 'INPUT' ? 0 : -1;
    this.disabled = false;
    this.inert = false;
    this.ownerDocument = null;
    this.rect = rect;
    this.rectReads = 0;
    this.focusOptions = [];
    this.scrollIntoViewOptions = [];
    this.childReads = 0;
  }

  get childElementCount() { return this.children.length; }
  getBoundingClientRect() {
    this.rectReads++;
    const { left, top, width, height } = this.rect;
    return {
      x: left, y: top, left, top, width, height,
      right: left + width, bottom: top + height, toJSON() { return this; }
    };
  }
  append(child) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.children.push(child); }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  hasAttribute() { return false; }
  getAttribute() { return null; }
  get elements() { this.childReads++; return this.children; }
  focus(options) {
    this.focusOptions.push(options);
    this.ownerDocument.activeElement = this;
    this.beforeFocusIn?.();
    this.ownerDocument.windowListeners.get('focusin')?.({ target: this });
  }
  scrollIntoView(options) {
    this.scrollIntoViewOptions.push(options);
    this.rect.top = 100;
  }
  dispatchEvent() { return true; }
  getSpatialNavigationContainer() { return this.ownerDocument.documentElement; }
  scrollBy() {}
}

function setup() {
  const listeners = new Map();
  const documentListeners = new Map();
  const styleReads = new Map();
  const documentElement = new FakeElement('HTML', { left: 0, top: 0, width: 1920, height: 1080 });
  const body = new FakeElement('BODY', { left: 0, top: 0, width: 1920, height: 1080 });
  const document = {
    documentElement,
    body,
    activeElement: null,
    windowListeners: listeners,
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    elementFromPoint() { return null; }
  };
  documentElement.ownerDocument = body.ownerDocument = document;
  documentElement.append(body);
  const window = {
    Element: FakeElement,
    document,
    parent: null,
    location: {},
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, callback) { listeners.set(type, callback); },
    getComputedStyle(element) {
      styleReads.set(element, (styleReads.get(element) || 0) + 1);
      return {
        display: 'block', visibility: 'visible', opacity: '1', height: '40px', width: '40px',
        overflowX: 'visible', overflowY: 'visible',
        getPropertyValue() { return ''; }
      };
    }
  };
  window.parent = window;
  window.listeners = listeners;
  const context = vm.createContext({
    window,
    document,
    Element: FakeElement,
    CustomEvent: class { constructor(type) { this.type = type; } },
    Set,
    Map,
    Math,
    Number,
    Object,
    Array
  });
  vm.runInContext(source, context, { filename: 'spatial-navigation.js' });
  listeners.get('load')?.();
  return { window, document, body, documentElement, styleReads, documentListeners };
}

function addInput(set, x) {
  const input = new FakeElement('INPUT', { left: x, top: 100, width: 40, height: 40 });
  input.ownerDocument = set.document;
  input.getSpatialNavigationContainer = () => set.documentElement;
  set.body.append(input);
  return input;
}

test('direct navigation caches each candidate rect and style for one call only', () => {
  const set = setup();
  assert.equal(set.window.__spatialNavigation__.keyMode, 'ARROW');
  set.window.__spatialNavigation__.keyMode = 'NONE';
  assert.equal(set.window.__spatialNavigation__.keyMode, 'NONE');
  const origin = addInput(set, 100);
  const next = addInput(set, 200);
  set.document.activeElement = origin;
  next.beforeFocusIn = () => { next.rectReadsBeforeFocusIn = next.rectReads; };

  set.window.navigate('right', { container: set.body, candidates: [origin, next] });
  assert.equal(set.document.activeElement, next);
  assert.equal(origin.rectReads, 1);
  assert.equal(next.rectReadsBeforeFocusIn, 1, 'candidate rect is cached before focus changes layout');
  assert.ok([...set.styleReads.values()].every(count => count === 1));

  set.window.navigate('right', { container: set.body, candidates: [origin, next] });
  assert.equal(next.rectReads, 3, 'rect cache is discarded between navigation calls');
});

test('an empty explicit candidate list does not walk default body candidates', () => {
  const set = setup();
  const origin = addInput(set, 100);
  addInput(set, 200);
  set.document.activeElement = origin;

  set.window.navigate('right', { container: set.body, candidates: [] });

  assert.equal(set.document.activeElement, origin);
  assert.equal(set.body.childReads, 0);
  assert.equal(origin.rectReads, 0);
  assert.equal(set.styleReads.size, 0);
});

test('direct navigation stays scoped and permits focus to scroll an offscreen row', () => {
  const set = setup();
  const origin = addInput(set, 100);
  const local = new FakeElement('INPUT', { left: 200, top: 1400, width: 40, height: 40 });
  local.ownerDocument = set.document;
  local.getSpatialNavigationContainer = () => set.documentElement;
  set.body.append(local);
  const after = addInput(set, 300);
  const elsewhere = new FakeElement('INPUT', { left: 300, top: 100, width: 40, height: 40 });
  elsewhere.ownerDocument = set.document;
  elsewhere.getSpatialNavigationContainer = () => set.documentElement;
  set.documentElement.append(elsewhere);
  set.document.activeElement = origin;

  set.window.navigate('right', { container: set.body, candidates: [origin, local, elsewhere] });

  assert.equal(set.document.activeElement, local);
  assert.equal(elsewhere.focusOptions.length, 0);
  assert.equal(local.focusOptions[0].preventScroll, false);
  assert.equal(local.scrollIntoViewOptions.length, 1);
  assert.equal(local.scrollIntoViewOptions[0].block, 'nearest');
  assert.equal(local.scrollIntoViewOptions[0].inline, 'nearest');
  assert.equal(local.rect.top, 100);

  set.window.navigate('right', { container: set.body, candidates: [origin, local, after] });
  assert.equal(set.document.activeElement, after, 'the next arrow uses the scrolled row geometry');
});

test('nested navigation drops geometry cached before focus changed layout state', () => {
  const set = setup();
  const origin = addInput(set, 100);
  const local = addInput(set, 200);
  const nestedTarget = addInput(set, 300);
  set.document.activeElement = origin;
  const originalFocusIn = set.document.windowListeners.get('focusin');
  let nested = false;
  set.document.windowListeners.set('focusin', event => {
    originalFocusIn(event);
    if (!nested) {
      nested = true;
      set.window.navigate('right', { container: set.body, candidates: [local, nestedTarget] });
    }
  });

  set.window.navigate('right', { container: set.body, candidates: [origin, local] });

  assert.equal(set.document.activeElement, nestedTarget);
  assert.ok(local.rectReads >= 3, 'focus and nested navigation remeasure after invalidation');
});

test('pointer coordinates do not poison explicit navigation or carry to the next call', () => {
  const set = setup();
  const origin = addInput(set, 100);
  const next = new FakeElement('INPUT', { left: 200.25, top: 100.5, width: 40.25, height: 40.75 });
  next.ownerDocument = set.document;
  next.getSpatialNavigationContainer = () => set.documentElement;
  set.body.append(next);
  set.document.activeElement = origin;

  set.documentListeners.get('mouseup')({ clientX: 1000, clientY: 800 });
  set.window.navigate('right', { container: set.body, candidates: [origin, next] });
  assert.equal(set.document.activeElement, next);
  assert.equal(next.focusOptions[0].preventScroll, false);

  set.window.navigate('left', { container: set.body, candidates: [origin, next] });
  assert.equal(set.document.activeElement, origin, 'the next call uses the focused element as origin');
});
