// The global keydown router: the remote key, the shortcut bound to it, the
// page it may run on (any, for a global one), the debounce, the call.
import { keyCodeOf, REMOTE_KEYS, SYNTHETIC_KEY_FLAG } from '../../core/remote.js';
import { isWatchPage, isShortsPage, isSearchPage } from '../../core/page-state.js';
import { getVideo } from '../../core/dom.js';
import { shortcutCache, getKeyColor, shortcutState } from './bindings.js';
import { isOptionsPanelVisible } from '../panel/panel.js';
import { ACTIONS } from './actions.js';
import { isOledOverlayActive, toggleOledOverlay } from './oled.js';

/** Whether `el` takes typed text: a textarea, or an input other than a checkbox or a colour. */
function isTextBox(el) {
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'color';
}

/** The shortcut key a keydown stands for ('red', '3', ...), or null. */
function keyNameOf(evt) {
  const color = getKeyColor(keyCodeOf(evt));
  if (color) return color;
  // A plain key in a text box is YouTube's; a digit elsewhere is a shortcut,
  // with the focus on one of the panel's checkboxes too.
  if (isTextBox(evt.target)) return null;
  if (evt.keyCode >= 48 && evt.keyCode <= 57) {
    return isSearchPage() ? null : String(evt.keyCode - 48);
  }
  return null;
}

// The last key this mod sent, so YouTube's unflagged re-send of it is not taken for a press.
const SYNTHETIC_ECHO_MS = 100;
const syntheticEcho = { key: null, time: 0 };

/** Whether the action may run on the current page. */
function inScope(action) {
  return action.global || isWatchPage() || isShortsPage();
}

/**
 * The shortcut router (capture phase, before YouTube): runs the action bound to the key, drops a
 * repeat of the same press, and leaves the keys to the options panel while it is open (apart from
 * the key that closes it).
 */
function onKeyDown(evt) {
  // A key this mod sends (the Shorts keep-alive's yellow, a seek) is meant for YouTube.
  if (evt[SYNTHETIC_KEY_FLAG]) {
    syntheticEcho.key = keyNameOf(evt);
    syntheticEcho.time = Date.now();
    return;
  }

  // While the black overlay is up, Back only takes it down: the screen is black, so a page
  // back underneath would go somewhere the user cannot see. 27 is the Escape webOS also sends.
  const code = keyCodeOf(evt);
  if ((code === REMOTE_KEYS.BACK.code || code === 27) && isOledOverlayActive()) {
    toggleOledOverlay();
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }

  const keyName = keyNameOf(evt);
  if (!keyName) return;
  // YouTube re-sends a colour key under its alternate code (405 as 170), unflagged, a few ms
  // later: the echo of one of this mod's keys is the mod's too.
  if (keyName === syntheticEcho.key && Date.now() - syntheticEcho.time < SYNTHETIC_ECHO_MS) return;

  const actionName = shortcutCache[keyName];
  if (!actionName || actionName === 'none') return;
  // Every bindable action has an entry (tests/unit/shortcut-actions-test.cjs),
  // and bindings.js turns any other stored name into None.
  const action = ACTIONS[actionName];
  if (!inScope(action)) return;

  // The same key again within the debounce is one press, and so is a held
  // key's repeat: neither reaches YouTube (a held digit would seek the app).
  // The seeks batch their presses, repeats included, themselves.
  const now = Date.now();
  const repeated =
    !action.burst &&
    (evt.repeat ||
      (now - shortcutState.lastTime < shortcutState.debounceMs &&
        shortcutState.lastKey === keyName));
  // With the panel open the keys are the panel's, apart from the one that closes it.
  const panelOwnsKeys = isOptionsPanelVisible() && actionName !== 'config_menu';
  if (repeated || panelOwnsKeys) {
    // A key held on a remote without the repeat flag keeps sliding the window.
    if (repeated) shortcutState.lastTime = now;
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }

  shortcutState.debounceMs = 100;
  shortcutState.lastTime = now;
  shortcutState.lastKey = keyName;
  evt.preventDefault();
  evt.stopPropagation();

  if (action.global) {
    action.run();
    return;
  }
  const video = getVideo();
  if (video) action.run(video);
}

// On window, not document: YouTube's own key handler sits on window capture and stops the colour
// keys it claims (yellow is search, Back navigates) before document sees the trusted press. The
// userScript runs before YouTube's code, so this listener is registered ahead of theirs.
window.addEventListener('keydown', onKeyDown, true);
