/**
 * The shortcut bindings as a unit: ui/shortcuts/bindings.js over a fake config
 * store, with the key and action tables of core/config-options.js. The yellow
 * key is configurable and starts at None, a binding stored under an action's
 * old name (chapter_skip_next) is read and stored under its new one at the
 * start and when it is written later, and an unknown action still becomes None.
 *
 * Run: node tests/unit/shortcut-bindings-test.cjs
 */
'use strict';

const path = require('path');
const { createReport } = require('../harness/report.cjs');
const { SRC } = require('../harness/stubs.cjs');
const { loadSources } = require('../harness/sandbox.cjs');

const report = createReport();
const eq = report.eq;

const tables = loadSources([path.join(SRC, 'core', 'config-options.js')], {
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1)
});
const SHORTCUT_KEYS = tables.get('SHORTCUT_KEYS');
const configOptions = tables.get('configOptions');
const shortcutActions = tables.get('shortcutActions');

/**
 * bindings.js loaded over a store holding the table defaults with `stored`
 * over them; `writes` lists every configWrite, `fire(key)` runs the change
 * listeners of that config key, `warns` collects the log's warnings.
 */
function load(stored) {
  const store = {};
  for (const key of SHORTCUT_KEYS) {
    store[`shortcut_key_${key}`] = configOptions.get(`shortcut_key_${key}`).default;
  }
  Object.assign(store, stored);
  const writes = [];
  const listeners = {};
  const warns = [];
  const { get } = loadSources([path.join(SRC, 'ui', 'shortcuts', 'bindings.js')], {
    configRead: (k) => store[k],
    configWrite: (k, v) => {
      writes.push(`${k}=${v}`);
      store[k] = v;
    },
    configAddChangeListener: (k, fn) => {
      (listeners[k] = listeners[k] || []).push(fn);
    },
    shortcutActions,
    COLOR_CODE_MAP: new Map(),
    showNotification: () => {},
    SHORTCUT_KEYS,
    log: { warn: (m) => warns.push(m), debug() {}, info() {} }
  });
  /** The config key changed: its listeners run, as config.js runs them after a write. */
  const fire = (k) => {
    for (const fn of listeners[k] || []) fn();
  };
  return { cache: get('shortcutCache'), store, writes, warns, fire };
}

// ---- the yellow key in the tables ------------------------------------------------
eq(
  'the configurable keys: the digits, then red, green, yellow and blue',
  SHORTCUT_KEYS.join(','),
  '0,1,2,3,4,5,6,7,8,9,red,green,yellow,blue'
);
eq(
  'shortcut_key_yellow is a config key that defaults to None',
  configOptions.get('shortcut_key_yellow') && configOptions.get('shortcut_key_yellow').default,
  'none'
);
eq(
  'with the label its panel row shows',
  configOptions.get('shortcut_key_yellow') && configOptions.get('shortcut_key_yellow').desc,
  'Yellow Button'
);
{
  const { cache, writes } = load({});
  eq('yellow is in the binding cache at its default', cache.yellow, 'none');
  eq('and the defaults are not written back', writes.join(','), '');
}
{
  const { cache } = load({ shortcut_key_yellow: 'play_pause' });
  eq('a stored yellow binding is read into the cache', cache.yellow, 'play_pause');
}

// ---- the renamed action --------------------------------------------------------
{
  const { cache, store, writes, warns } = load({ shortcut_key_4: 'chapter_skip_next' });
  eq('a stored chapter_skip_next is read as chapter_skip', cache['4'], 'chapter_skip');
  eq(
    'and written back under the new name at the start',
    writes.join(','),
    'shortcut_key_4=chapter_skip'
  );
  eq('the store holds the new name', store.shortcut_key_4, 'chapter_skip');
  eq('with no warning: it is not an unknown action', warns.join(' | '), '');
}
{
  const { cache, store, writes, warns, fire } = load({});
  store.shortcut_key_7 = 'chapter_skip_next';
  fire('shortcut_key_7');
  eq('the old name written later is renamed by the change listener', cache['7'], 'chapter_skip');
  eq('and stored renamed', writes.join(','), 'shortcut_key_7=chapter_skip');
  eq('still without a warning', warns.join(' | '), '');
}
{
  const { cache, writes, warns } = load({ shortcut_key_2: 'bogus_action' });
  eq('an unknown action is still set to None', cache['2'], 'none');
  eq('and stored as None', writes.join(','), 'shortcut_key_2=none');
  eq('with one warning', warns.length, 1);
}

report.finish();
