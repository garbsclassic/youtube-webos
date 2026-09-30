/**
 * Side-panel close fix -- NicholasBly/youtube-webos#188 and #154.
 *
 * A YouTube-side bug, also on the stock app since late September 2026. Pressing Back on the
 * comments panel adds a "closing" class to <ytlr-animated-overlay> (currently `frHKed`).
 * YouTube's CSS for that class collapses the panel contents to 0x0 at once, but the list stays
 * mounted for ~350 ms while the close animation runs. The list watches its rows with a
 * ResizeObserver, so it records every row as 0 tall and saves that into the per-video list
 * state. Reopening restores it: every row stacks at the top with height 0 and arrow navigation
 * gets stuck. The Description panel uses the same overlay and breaks the same way.
 *
 * Fix: for every YouTube rule on the closing classes that hides or zero-sizes something, add an
 * override that keeps the element laid out but invisible. The panel looks the same while it
 * closes, the ResizeObserver never sees 0, and the saved state keeps the real heights.
 *
 * The closing class is also briefly present while a panel opens, and the Description panel's
 * rows are measured in that window -- so the override must exist before the first panel opens.
 * The rules are found by scanning the stylesheets at startup, retrying every second until
 * YouTube's CSS has loaded, with a scan on panel focus as a backstop. A broad fallback applies
 * until the real rule is found.
 *
 * `frHKed`, `xmQAdc` and `AmQJbe` are YouTube's obfuscated class names and may change.
 */

const CLOSE_CLASSES = ['frHKed', 'xmQAdc'];
const FALLBACK_CSS =
  'ytlr-animated-overlay.frHKed .AmQJbe, ytlr-animated-overlay.frHKed .AmQJbe * { display: revert !important; }';
const MAX_FOCUS_SCANS = 3;
const STARTUP_RETRY_MS = 1000;
const STARTUP_MAX_TRIES = 30;

// Any side panel: comments, description, and the rest share the overlay and its closing class.
const PANEL_SELECTOR = '.AmQJbe, ytlr-engagement-panel-section-list-renderer';

let styleEl = null;
let foundRules = false;
let focusScans = 0;
let startupTries = 0;

function collectRules(sheets) {
  const rules = [];
  const walk = list => {
    if (!list) return;
    for (const rule of list) {
      if (rule.selectorText) rules.push(rule);
      else if (rule.cssRules) walk(rule.cssRules); // @media / @supports
    }
  };
  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheet
    }
  }
  return rules;
}

function isZero(value) {
  return value === '0' || value === '0px' || value === '0rem';
}

export function findCollapsingSelectors(
  sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])]
) {
  const selectors = [];
  for (const rule of collectRules(sheets)) {
    const sel = rule.selectorText;
    if (!CLOSE_CLASSES.some(cls => sel.includes(`.${cls}`))) continue;

    const s = rule.style;
    if (s.display === 'none' || isZero(s.height) || isZero(s.width) || isZero(s.maxHeight)) {
      selectors.push(sel);
    }
  }
  return selectors;
}

export function applyCommentsCloseFix(fromStartup = false) {
  if (foundRules) return;
  if (!fromStartup) {
    if (focusScans >= MAX_FOCUS_SCANS) return;
    focusScans++;
  }

  const selectors = findCollapsingSelectors();
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ytaf-comments-close-fix';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  if (selectors.length) {
    foundRules = true;
    styleEl.textContent = selectors
      .map(
        sel =>
          `${sel} { display: block !important; height: auto !important; width: auto !important;` +
          ' max-height: none !important; visibility: hidden !important; }'
      )
      .join('\n');
    console.info(`[CommentsFix] Close-collapse override applied to: ${selectors.join(' , ')}`);
  } else {
    styleEl.textContent = FALLBACK_CSS;
    if (!fromStartup) {
      console.info(
        `[CommentsFix] No collapsing close rule found (scan ${focusScans}/${MAX_FOCUS_SCANS}), using fallback`
      );
    }
  }
}

// A panel always opens before it can close, so scanning on first focus inside one still lands
// the override before it is needed.
function onFocusIn(e) {
  if (foundRules || focusScans >= MAX_FOCUS_SCANS) {
    document.removeEventListener('focusin', onFocusIn, true);
    return;
  }
  if (e.target?.closest?.(PANEL_SELECTOR)) applyCommentsCloseFix();
}

function startupScan() {
  applyCommentsCloseFix(true);
  if (!foundRules && ++startupTries < STARTUP_MAX_TRIES) {
    setTimeout(startupScan, STARTUP_RETRY_MS);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', onFocusIn, true);
  startupScan();
}
