/**
 * The yellow shortcut key and Back under the OLED overlay, against the built
 * bundle: a yellow binding runs on the watch page from both of its codes, a
 * yellow left at None is YouTube's, a yellow the mod sends itself (the Shorts
 * keep-alive's, through core/remote.js sendKey) runs no binding and neither
 * does YouTube's unstamped re-send of it within 100 ms, Back and
 * Escape with the black overlay up take it down and reach nothing else, its
 * repeats and its keyup held from YouTube until the release or 2 s,
 * without the overlay they are left alone, and a key the router handles on
 * window capture goes no further than the listeners on window itself.
 *
 * Run: node tests/behaviour/shortcuts-yellow-back-test.cjs [bundle] [legacy|modern]
 */
const { createPage } = require('../harness/page.cjs');
const { createReport } = require('../harness/report.cjs');
const {
  wait,
  waitFor,
  KEYS,
  ALT,
  press: pressOn,
  pressTrusted,
  toasts: toastsOf,
  videoModel,
  clock
} = require('../harness/fixtures.cjs');

const report = createReport();
const t = report.check;

const PLAYER_ID = 'ytlr-player__player-container-player';
const OVERLAY_ID = 'ytaf-oled-overlay';
// The Shorts keep-alive's 30s interval at a hundredth, 300 ms; the 250 ms
// between its two presses at 2.5 ms.
const FAST_TIMERS = { scale: 100, from: 200 };

/**
 * A watch page with a paused <video> over a playback model, `cfg` over the
 * harness's configuration, and every keydown that reaches the document
 * recorded in `keys` (a document capture listener, behind the router's).
 * `timers` goes to createPage, to shorten the router's 2s Back hold.
 */
function boot(cfg, timers) {
  let model;
  const page = createPage({
    page: 'watch',
    config: Object.assign({}, cfg),
    captureKeys: true,
    timers,
    setup(win) {
      model = videoModel(win, { currentTime: 10, duration: 100, paused: true });
    }
  });
  const win = page.win;
  const d = win.document;
  return {
    win,
    d,
    model,
    keys: page.keys,
    press: (code) => pressOn(win, code, d.body),
    toasts: () => toastsOf(win),
    overlay: () => d.getElementById(OVERLAY_ID)
  };
}

/** A Shorts page whose player reports PLAYING, so the keep-alive presses yellow. */
function bootShorts(cfg) {
  const page = createPage({
    html:
      '<!doctype html><html><body class="WEB_PAGE_TYPE_SHORTS"><ytlr-app>' +
      `<div id="${PLAYER_ID}"></div></ytlr-app></body></html>`,
    url: 'https://www.youtube.com/tv#/shorts/abcdefghijk',
    config: Object.assign({}, cfg),
    captureKeys: true,
    timers: FAST_TIMERS,
    setup(win) {
      win.document.getElementById(PLAYER_ID).getPlayerState = () => 1;
    }
  });
  return { win: page.win, d: page.win.document, keys: page.keys };
}

(async () => {
  // ---- a yellow binding on the watch page ------------------------------------------------
  {
    const { win, model, keys, press } = boot({ shortcut_key_yellow: 'play_pause' });
    const bubbled = [];
    win.addEventListener('keydown', (e) => bubbled.push(e.keyCode));
    const first = press(KEYS.YELLOW);
    t(
      'yellow (405) bound to play_pause plays the video and is kept from YouTube',
      model.plays === 1 && first.defaultPrevented,
      `plays ${model.plays}, prevented ${first.defaultPrevented}`
    );
    t(
      'the handled press stops at the router: neither the document nor window bubbling sees it',
      keys.indexOf(KEYS.YELLOW) === -1 && bubbled.indexOf(KEYS.YELLOW) === -1,
      `document ${keys.join(',')}, bubble ${bubbled.join(',')}`
    );
    await wait(150); // past the repeated-key debounce
    const alt = press(ALT.YELLOW);
    t(
      'the alternate yellow code (170) runs the same binding: the video pauses',
      model.pauses === 1 && alt.defaultPrevented && keys.indexOf(ALT.YELLOW) === -1,
      `pauses ${model.pauses}, prevented ${alt.defaultPrevented}`
    );
  }

  // ---- yellow left at its default, None --------------------------------------------------
  {
    const { model, keys, press } = boot();
    const yellow = press(KEYS.YELLOW);
    const alt = press(ALT.YELLOW);
    t(
      'yellow at None: both codes run nothing and are not prevented',
      model.plays === 0 && !yellow.defaultPrevented && !alt.defaultPrevented,
      `plays ${model.plays}`
    );
    t(
      'and both reach the document, where YouTube listens',
      keys.indexOf(KEYS.YELLOW) !== -1 && keys.indexOf(ALT.YELLOW) !== -1,
      keys.join(',')
    );
  }

  // ---- a yellow the mod sends itself -----------------------------------------------------
  {
    const { win, d, model, keys } = boot({ shortcut_key_yellow: 'play_pause' });
    const synthetic = pressTrusted(win, KEYS.YELLOW, d.body, true);
    t(
      'a yellow stamped as the mod sent it runs no binding and passes through to YouTube',
      model.plays === 0 && !synthetic.defaultPrevented && keys.indexOf(KEYS.YELLOW) !== -1,
      `plays ${model.plays}, prevented ${synthetic.defaultPrevented}`
    );
    // Past the 100 ms in which an unstamped press of the same key counts as YouTube's echo.
    clock(win).offset += 150;
    const real = pressTrusted(win, KEYS.YELLOW, d.body);
    t(
      'an unstamped trusted yellow 150 ms after a stamped one runs the binding',
      model.plays === 1 && real.defaultPrevented,
      `plays ${model.plays}`
    );
  }
  {
    // YouTube sends a colour key it receives again under its alternate code, unstamped, ~5 ms on.
    const { win, d, model } = boot({ shortcut_key_yellow: 'play_pause' });
    const c = clock(win);
    pressTrusted(win, KEYS.YELLOW, d.body, true);
    c.offset += 5;
    const echo = pressTrusted(win, ALT.YELLOW, d.body);
    t(
      "a stamped 405 then an unstamped 170 5 ms later: the echo is the mod's, nothing runs",
      model.plays === 0 && !echo.defaultPrevented,
      `plays ${model.plays}, prevented ${echo.defaultPrevented}`
    );
  }
  {
    const { win, d, model } = boot({ shortcut_key_yellow: 'play_pause' });
    const c = clock(win);
    pressTrusted(win, KEYS.YELLOW, d.body, true);
    c.offset += 5;
    const green = pressTrusted(win, KEYS.GREEN, d.body);
    const panel = d.querySelector('.ytaf-ui-container');
    t(
      'a stamped yellow does not hold back a different key: green 5 ms later opens the settings',
      green.defaultPrevented && !!panel && panel.style.display === 'block' && model.plays === 0,
      panel ? panel.style.display : 'no panel'
    );
  }
  {
    const { d, keys } = bootShorts({ shortcut_key_yellow: 'toggle_oled' });
    const pressed = await waitFor(
      () => keys.indexOf(KEYS.YELLOW) !== -1 && keys.indexOf(ALT.YELLOW) !== -1,
      3000
    );
    t('setup: the Shorts keep-alive pressed both yellow codes', !!pressed, keys.join(','));
    t(
      "the keep-alive's yellows do not run the yellow binding (no OLED overlay)",
      !d.getElementById(OVERLAY_ID)
    );
  }

  // ---- Back and Escape with the OLED overlay up ------------------------------------------
  {
    const { model, keys, press, toasts, overlay } = boot();
    press(KEYS.RED); // the default red binding: the overlay
    t('setup: red puts the overlay up', !!overlay());
    const back = press(KEYS.BACK);
    t(
      'Back with the overlay up takes it down and is kept from YouTube',
      !overlay() && back.defaultPrevented && keys.indexOf(KEYS.BACK) === -1,
      `prevented ${back.defaultPrevented}, document ${keys.join(',')}`
    );
    t(
      'and the deactivation toast shows',
      toasts().some((m) => m === 'Black Overlay Deactivated'),
      toasts().join(' | ')
    );
    await wait(150); // past the debounce of the red press
    press(KEYS.RED);
    t('setup: red puts the overlay up again', !!overlay());
    const esc = press(KEYS.ESCAPE);
    t(
      'Escape (27) with the overlay up takes it down and is kept from YouTube too',
      !overlay() && esc.defaultPrevented && keys.indexOf(KEYS.ESCAPE) === -1,
      `prevented ${esc.defaultPrevented}, document ${keys.join(',')}`
    );
    t('no playback change on the way', model.plays === 0 && model.pauses === 0);
  }

  // ---- a held Back after it took the overlay down ----------------------------------------
  {
    // The 2s hold at a twentieth, 100 ms; the 100 ms key debounce and the toasts' shorter
    // timers keep their length.
    const { win, d, keys, press, toasts, overlay } = boot({}, { scale: 20, from: 1500 });
    const ups = [];
    d.addEventListener('keyup', (e) => ups.push(e.keyCode), true);
    /** A keyup of `code` on the body, as the remote sends it on release. */
    const release = (code) => {
      const evt = new win.KeyboardEvent('keyup', {
        keyCode: code,
        bubbles: true,
        cancelable: true
      });
      d.body.dispatchEvent(evt);
      return evt;
    };
    press(KEYS.RED);
    t('setup: red puts the overlay up', !!overlay());
    press(KEYS.BACK);
    t('setup: Back takes it down', !overlay());
    const repeats = [press(KEYS.BACK), press(KEYS.BACK), press(KEYS.BACK)];
    t(
      'the held Back repeats are kept from YouTube: prevented, none reaches the document',
      repeats.every((e) => e.defaultPrevented) && keys.indexOf(KEYS.BACK) === -1,
      keys.join(',')
    );
    t(
      'and they raise nothing again: no overlay, one deactivation toast',
      !overlay() && toasts().filter((m) => m === 'Black Overlay Deactivated').length === 1,
      toasts().join(' | ')
    );
    const up = release(KEYS.BACK);
    t(
      'the keyup of the held Back is swallowed too',
      up.defaultPrevented && ups.indexOf(KEYS.BACK) === -1,
      ups.join(',')
    );
    const after = press(KEYS.BACK);
    t(
      'after the keyup a new Back with no overlay passes through to YouTube',
      !after.defaultPrevented && keys.indexOf(KEYS.BACK) !== -1,
      keys.join(',')
    );
    const laterUp = release(KEYS.BACK);
    t(
      'and so does its keyup: the hold is over',
      !laterUp.defaultPrevented && ups.indexOf(KEYS.BACK) !== -1,
      ups.join(',')
    );
  }
  {
    // A TV that never sends the keyup: the hold ends on its own after 2s (100 ms here).
    const { keys, press, overlay } = boot({}, { scale: 20, from: 1500 });
    press(KEYS.RED);
    press(KEYS.ESCAPE);
    t('setup: Escape takes the overlay down', !overlay());
    const held = press(KEYS.ESCAPE);
    t('setup: a repeat of it is held', held.defaultPrevented && keys.indexOf(KEYS.ESCAPE) === -1);
    await wait(250);
    const later = press(KEYS.ESCAPE);
    t(
      'with no keyup the hold ends after 2 s: the next Escape passes through',
      !later.defaultPrevented && keys.indexOf(KEYS.ESCAPE) !== -1,
      keys.join(',')
    );
  }

  // ---- Back and Escape without the overlay -----------------------------------------------
  {
    const { keys, press, overlay } = boot();
    const back = press(KEYS.BACK);
    const esc = press(KEYS.ESCAPE);
    t(
      'without the overlay Back and Escape are not prevented and reach the document',
      !overlay() &&
        !back.defaultPrevented &&
        !esc.defaultPrevented &&
        keys.indexOf(KEYS.BACK) !== -1 &&
        keys.indexOf(KEYS.ESCAPE) !== -1,
      keys.join(',')
    );
  }

  // ---- a window listener registered after the router -------------------------------------
  {
    const { win, model, press } = boot({ shortcut_key_yellow: 'play_pause' });
    const capture = [];
    win.addEventListener('keydown', (e) => capture.push(e.defaultPrevented), true);
    press(KEYS.YELLOW);
    // stopPropagation() spares the listeners on the node it is called on, so a
    // later window capture listener (YouTube's) still runs, after the router.
    t(
      'a later window capture listener runs after the router, the key already prevented',
      model.plays === 1 && capture.length === 1 && capture[0] === true,
      `plays ${model.plays}, seen ${JSON.stringify(capture)}`
    );
  }

  report.finish();
})();
