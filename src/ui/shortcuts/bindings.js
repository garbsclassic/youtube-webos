// Which remote key runs which shortcut: the configurable bindings, the
// colour-key lookup and the debounce state shared with the actions.
import {
  configAddChangeListener,
  configRead,
  configWrite,
  shortcutActions
} from '../../core/config.js';
import { SHORTCUT_KEYS } from '../../core/config-options.js';
import { COLOR_CODE_MAP } from '../../core/remote.js';
import { showNotification } from '../toast/index.js';
import { log } from './log.js';

// Shortcut key name -> action name, kept current by the config listeners.
export const shortcutCache = {};

// The action names 0.3.0 stored, and the action each is now. The burst seek
// 0.3.0 called seek_15_fwd stepped 5s; it becomes the 15s one.
const RENAMED_ACTIONS = {
  chapter_skip: 'chapter_skip_next',
  oled_toggle: 'toggle_oled',
  sb_manual_skip: 'sb_skip_highlight',
  seek_15_back: 'seek_back_15',
  seek_15_fwd: 'seek_fwd_15',
  seek_back: 'seek_back_10',
  seek_back_ex: 'seek_back_30',
  seek_fwd: 'seek_fwd_10',
  seek_fwd_ex: 'seek_fwd_30',
  toggle_subs: 'toggle_subtitles'
};

/**
 * Reads one binding. A renamed action is stored again under its new name. An
 * action this build does not have (a binding stored by an older one) becomes
 * None, in the cache and in the config, so the key is the app's again and the
 * panel shows a value it knows; warned once, here.
 */
function updateShortcutCache(key) {
  const configKey = `shortcut_key_${key}`;
  let action = configRead(configKey);
  if (Object.prototype.hasOwnProperty.call(RENAMED_ACTIONS, action)) {
    action = RENAMED_ACTIONS[action];
    configWrite(configKey, action);
  }
  if (Object.prototype.hasOwnProperty.call(shortcutActions, action)) {
    shortcutCache[key] = action;
    return;
  }
  log.warn(`Unknown action "${action}" on key ${key}: set to None`);
  shortcutCache[key] = 'none';
  configWrite(configKey, 'none');
}

SHORTCUT_KEYS.forEach((key) => {
  updateShortcutCache(key);
  configAddChangeListener(`shortcut_key_${key}`, () => updateShortcutCache(key));
});

/**
 * The settings must stay reachable: with no key bound to the menu, Green is
 * bound to it again, said with `announce`. The key that opens the menu, and
 * whether Green was just bound to it. Run at the start and whenever the panel
 * closes (a binding changed on it may have unbound the menu).
 */
export function ensureMenuKey(announce) {
  const key = SHORTCUT_KEYS.find((k) => shortcutCache[k] === 'config_menu');
  if (key) return { key, rebound: false };
  log.warn('No menu keybind found. Forcing Green button to Open Settings.');
  configWrite('shortcut_key_green', 'config_menu');
  if (announce) showNotification('Press [GREEN] to open settings');
  return { key: 'green', rebound: true };
}

// Colour-key code to name, alternates included, from REMOTE_KEYS in core/remote.js.
export const getKeyColor = (code) => COLOR_CODE_MAP.get(code) || null;

// Debounce between repeated presses of the same shortcut. playPause widens it
// briefly after a pause so the controls-dismiss dance is not interrupted.
export const shortcutState = {
  lastTime: 0,
  lastKey: null,
  debounceMs: 100
};
