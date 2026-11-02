import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config batches writes, flushes on pagehide, and can schedule again', async () => {
  const timers = new Map();
  const listeners = new Map();
  const writes = [];
  let nextId = 0;
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.window = {
    localStorage: {
      getItem() { return null; },
      set 'ytaf-configuration'(value) { writes.push(JSON.parse(value)); }
    },
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  globalThis.setTimeout = callback => {
    const id = ++nextId;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);

  try {
    const { configWrite } = await import('../src/config.ts');
    configWrite('showWatch', true);
    configWrite('enableOledCareMode', true);
    assert.equal(timers.size, 1);
    assert.equal(writes.length, 0);
    timers.values().next().value();
    assert.equal(timers.size, 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].showWatch, true);
    assert.equal(writes[0].enableOledCareMode, true);

    configWrite('showWatch', false);
    assert.equal(timers.size, 1);
    listeners.get('pagehide')();
    assert.equal(timers.size, 0);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].showWatch, false);
    listeners.get('beforeunload')();
    assert.equal(writes.length, 2);

    configWrite('showWatch', true);
    assert.equal(timers.size, 1);
    timers.values().next().value();
    assert.equal(writes.length, 3);
    assert.equal(writes[2].showWatch, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
