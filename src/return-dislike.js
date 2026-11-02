import { configRead, configAddChangeListener } from './config';

// Global cache for API responses
const dislikeCache = new Map();
const CACHE_DURATION = 300000; // 5 minutes

// Feature detection
const HAS_ABORT_CONTROLLER = typeof AbortController !== 'undefined';
const HAS_INTERSECTION_OBSERVER = typeof IntersectionObserver !== 'undefined';

// Focus arrives on descendants; find the panel without selector matching.
const PANEL_TAG = 'YTLR-STRUCTURED-DESCRIPTION-CONTENT-RENDERER';

function closestPanel(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    if (n.tagName === PANEL_TAG) return n;
  }
  return null;
}

// Shown while the count is still unknown, so the factoid can be laid out immediately
// instead of appearing late.
const DISLIKE_PLACEHOLDER = '\u2014'; // em dash
const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_BASE_MS = 1200;

const SELECTORS = {
  panel: 'ytlr-structured-description-content-renderer',
  standardContainer: '.ytLrVideoDescriptionHeaderRendererFactoidContainer',
  compactContainer: '.rznqCe',
  stdFactoid: '.ytLrVideoDescriptionHeaderRendererFactoid',
  stdValue: '.ytLrVideoDescriptionHeaderRendererValue',
  stdLabel: '.ytLrVideoDescriptionHeaderRendererLabel',
  cptFactoid: '.nOJlw',
  cptValue: '.axf6h',
  cptLabel: '.Ph2lNb'
};

class ReturnYouTubeDislike {
  constructor(videoID) {
    this.videoID = videoID;
    this.active = true;
    // null until a fetch succeeds, so "the API said zero" stays distinct from "the request
    // failed".
    this.dislikesValue = null;
    this.dislikeValueElement = null;
    this.dislikeFactoidElement = null;
    this.fetchAttempts = 0;

    this.timers = {};
    this.observers = new Set();
    this.abortController = null;
    this.fetchRequest = null;
    this.panelElement = null;

    this.cachedMode = null;
    this.focusListenerActive = false;
    this.handleFocusIn = this.handleFocusIn.bind(this);
    this.handlePanelMutation = this.handlePanelMutation.bind(this);

    this.modeConfigs = {
      standard: {
        containerSelector: SELECTORS.standardContainer,
        factoidClass: SELECTORS.stdFactoid,
        valueSelector: SELECTORS.stdValue,
        labelSelector: SELECTORS.stdLabel
      },
      compact: {
        containerSelector: SELECTORS.compactContainer,
        factoidClass: SELECTORS.cptFactoid,
        valueSelector: SELECTORS.cptValue,
        labelSelector: SELECTORS.cptLabel
      }
    };
  }

  log(level, message) {
    let args = [].slice.call(arguments, 2);
    let prefix = '[RYD:' + this.videoID + '] [' + level.toUpperCase() + ']';
    console.log.apply(console, [prefix, message].concat(args));
  }

  // --- Timer Management ---
  setTimeout(callback, delay, name) {
    clearTimeout(this.timers[name]);
    if (!this.active) return null;
    this.timers[name] = setTimeout(() => {
      delete this.timers[name];
      if (this.active) callback();
    }, delay);
    return this.timers[name];
  }

  clearAllTimers() {
    Object.keys(this.timers).forEach(key => {
      clearTimeout(this.timers[key]);
    });
    this.timers = {};
  }

  // --- Initialization ---
  async init() {
    this.log('info', 'Initializing...');
    try {
      this.injectPersistentStyles();
      this.setupPanelDetection();

      // Panel detection must not sit behind the network: a cold first request to the RYD API
      // can take seconds, up to the 8s race timeout.
      this.observeBodyForPanel();

      await this.fetchVideoData();
      if (!this.active) return;
      if (this.panelElement) this.checkAndInjectDislike(this.panelElement);
    } catch (error) {
      this.log('error', 'Init error:', error);
    }
  }

  async fetchVideoData() {
    if (!this.active || !this.videoID) return;

    const cached = dislikeCache.get(this.videoID);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      this.dislikesValue = cached.dislikes;
      this.updateDislikeDisplay();
      return;
    }

    this.abortController?.abort();
    const controller = HAS_ABORT_CONTROLLER ? new AbortController() : null;
    this.abortController = controller;
    const request = {};
    this.fetchRequest = request;
    let timeoutId;

    try {
      const data = await Promise.race([
        (async () => {
          const response = await fetch(
            `https://returnyoutubedislikeapi.com/votes?videoId=${this.videoID}`,
            controller ? { signal: controller.signal } : {}
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('Timeout'));
            controller?.abort();
          }, 8000);
        })
      ]);
      if (!this.active || this.fetchRequest !== request) return;
      if (!Number.isFinite(data?.dislikes) || data.dislikes < 0)
        throw new Error('Invalid dislike count');
      this.dislikesValue = data.dislikes;
      this.fetchAttempts = 0;

      dislikeCache.set(this.videoID, { dislikes: this.dislikesValue, timestamp: Date.now() });
      if (dislikeCache.size > 50) dislikeCache.delete(dislikeCache.keys().next().value);

      // The panel may already be on screen showing the placeholder.
      this.updateDislikeDisplay();
    } catch (error) {
      if (!this.active || this.fetchRequest !== request) return;
      if (!HAS_ABORT_CONTROLLER || error.name !== 'AbortError')
        this.log('error', 'Fetch error:', error);
      this.dislikesValue = null; // unknown, NOT zero -- and never cached

      // A cold DNS + TLS handshake on real TV hardware is far slower than on the simulator,
      // so back off and retry rather than failing for good.
      if (this.active && error.name !== 'AbortError' && ++this.fetchAttempts <= FETCH_MAX_RETRIES) {
        const delay = FETCH_RETRY_BASE_MS * this.fetchAttempts;
        this.log('info', `Retrying dislike fetch in ${delay}ms (attempt ${this.fetchAttempts})`);
        this.setTimeout(
          () => {
            if (this.active) this.fetchVideoData();
          },
          delay,
          'rydRetry'
        );
      }
    } finally {
      clearTimeout(timeoutId);
      if (this.fetchRequest === request) {
        this.fetchRequest = null;
        this.abortController = null;
      }
    }
  }

  /**
   * Rewrite the already-injected factoid in place. Injection does not wait for the network,
   * so this turns the placeholder into the real number whenever the fetch lands -- first try
   * or third.
   */
  updateDislikeDisplay() {
    const valueElement = this.dislikeValueElement;
    if (!valueElement || !valueElement.isConnected) return;

    const text =
      this.dislikesValue === null ? DISLIKE_PLACEHOLDER : this.formatNumber(this.dislikesValue);
    if (valueElement.textContent === text) return;

    valueElement.textContent = text;
    if (this.dislikeFactoidElement) {
      this.dislikeFactoidElement.setAttribute('aria-label', `${text} Dislikes`);
    }
  }

  // --- Observer Logic ---

  // Release a panel that has gone away before binding its replacement.
  resetPanelState() {
    this.dislikeValueElement = null;
    this.dislikeFactoidElement = null;
    this.panelElement = null;
    this.cachedMode = null;
  }

  stopBodyPoll() {
    if (this.bodyPollInterval) {
      clearInterval(this.bodyPollInterval);
      this.bodyPollInterval = null;
    }
  }

  // Bounded poll, and only a safety net: the panel is also detected by handleFocusIn (focus is the
  // only reliable signal for the role="dialog" description panel) and by ui.js calling
  // observeBodyForPanel() after the description shortcut fires. So it gets ~10s per arm
  // and then goes idle until something re-arms it.
  observeBodyForPanel() {
    if (!this.active) return;

    this.stopBodyPoll();
    // Immediate check first -- usually resolves without ever arming the timer.
    const existingPanel = document.querySelector(SELECTORS.panel);
    if (existingPanel) {
      this.setupPanel(existingPanel);
      return;
    }

    let attempts = 0;
    this.bodyPollInterval = setInterval(() => {
      if (!this.active || ++attempts > 20) {
        // ~10s ceiling
        this.stopBodyPoll();
        return;
      }

      if (this.panelElement) {
        if (this.panelElement.isConnected) return; // Panel is active and connected
        this.resetPanelState();
      }

      const panel = document.querySelector(SELECTORS.panel);
      if (panel) {
        this.setupPanel(panel);
        this.stopBodyPoll();
      }
    }, 500);
  }

  setupPanel(panel) {
    if (!this.active) return;

    if (this.panelElement === panel) {
      this.checkAndInjectDislike(panel);
      return;
    }

    this.resetPanelState();
    this.panelElement = panel;
    this.attachContentObserver(panel);
    this.setupPanelDetection();

    if (HAS_INTERSECTION_OBSERVER) {
      this.setupIntersectionObserver(panel);
    } else {
      this.checkAndInjectDislike(panel);
    }
  }

  attachContentObserver(panelElement) {
    if (this.panelContentObserver) {
      this.panelContentObserver.disconnect();
      this.observers.delete(this.panelContentObserver);
    }
    this.panelContentObserver = new MutationObserver(this.handlePanelMutation);
    this.panelContentObserver.observe(panelElement, { childList: true, subtree: true });
    this.observers.add(this.panelContentObserver);
  }

  setupIntersectionObserver(panelElement) {
    if (!HAS_INTERSECTION_OBSERVER) return;
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.observers.delete(this.intersectionObserver);
    }
    this.intersectionObserver = new IntersectionObserver(
      entries => {
        if (!this.active) return;
        if (entries[0].isIntersecting) {
          this.checkAndInjectDislike(this.panelElement);
        }
      },
      { threshold: 0.1 }
    );
    this.intersectionObserver.observe(panelElement);
    this.observers.add(this.intersectionObserver);
  }

  handlePanelMutation() {
    if (!this.active) return;

    this.setTimeout(
      () => {
        if (!this.active || !this.panelElement) return;
        this.checkAndInjectDislike(this.panelElement);
      },
      200,
      'injectDebounce'
    );
  }

  setupPanelDetection() {
    if (this.focusListenerActive) return;
    document.addEventListener('focusin', this.handleFocusIn, { capture: true });
    this.focusListenerActive = true;
  }

  handleFocusIn(e) {
    if (!this.active) return;
    const panel = closestPanel(e.target);
    if (panel && panel !== this.panelElement) {
      this.setupPanel(panel);
    } else if (this.panelElement && !this.panelElement.isConnected) {
      this.resetPanelState();
      this.observeBodyForPanel();
    }
  }

  checkAndInjectDislike(panelElement) {
    if (!this.active) return;
    // Deliberately not gated on the fetch. Waiting for the network meant that on a slow
    // first request the panel finished rendering with no dislike factoid at all, and it
    // only appeared later when some unrelated mutation or focus change happened to re-run
    // this. Inject now, fill in the number when it arrives.
    const existing = panelElement.querySelector('#ryd-dislike-factoid');
    if (existing) {
      this.dislikeFactoidElement = existing;
      this.dislikeValueElement = existing.querySelector(`${SELECTORS.stdValue}, ${SELECTORS.cptValue}`);
      this.updateDislikeDisplay();
      return;
    }

    try {
      // Check if we already detected the mode. If so, skip the DOM queries.
      let mode = this.cachedMode;
      if (!mode) {
        const standardContainer = panelElement.querySelector(
          this.modeConfigs.standard.containerSelector
        );
        const compactContainer = panelElement.querySelector(
          this.modeConfigs.compact.containerSelector
        );
        mode = standardContainer
          ? this.modeConfigs.standard
          : compactContainer
            ? this.modeConfigs.compact
            : null;
        if (mode) this.cachedMode = mode;
      }
      if (!mode) return;

      const container = panelElement.querySelector(mode.containerSelector);
      const likesElement = container.querySelector(
        `div[idomkey="factoid-0"]${mode.factoidClass}, div[aria-label*="like"]${mode.factoidClass}, div[aria-label*="Like"]${mode.factoidClass}`
      );

      if (!likesElement) return;

      const dislikeElement = likesElement.cloneNode(true);
      dislikeElement.id = 'ryd-dislike-factoid';
      dislikeElement.setAttribute('idomkey', 'factoid-ryd');

      const valueElement = dislikeElement.querySelector(mode.valueSelector);
      const labelElement = dislikeElement.querySelector(mode.labelSelector);

      if (valueElement && labelElement) {
        const dislikeText =
          this.dislikesValue === null ? DISLIKE_PLACEHOLDER : this.formatNumber(this.dislikesValue);
        valueElement.textContent = dislikeText;
        labelElement.textContent = 'Dislikes';
        dislikeElement.setAttribute('aria-label', `${dislikeText} Dislikes`);
        // Keep handles so updateDislikeDisplay() can fill this in later.
        this.dislikeValueElement = valueElement;
        this.dislikeFactoidElement = dislikeElement;
      }

      likesElement.insertAdjacentElement('afterend', dislikeElement);
    } catch (error) {
      this.log('error', 'Injection error:', error);
    }
  }

  formatNumber(num) {
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return num.toString();
  }

  injectPersistentStyles() {
    if (document.getElementById('ryd-persistent-styles')) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'ryd-persistent-styles';
    // Keep Views/Date in their native columns; Likes and Dislikes share the first column.
    // Preserving header height lets YouTube own row measurement and virtual scrolling.
    const stats = `${SELECTORS.panel} :has(> #ryd-dislike-factoid)`;
    styleElement.textContent = `
      ${stats} {
        display: grid !important;
        grid-template-columns: 1fr 1fr 2fr 2fr !important;
        gap: 0 !important;
      }
      ${stats} > div {
        width: auto !important;
        min-width: 0 !important;
        margin-inline: 0 !important;
      }
      ${stats} > div:nth-child(-n+2) ${SELECTORS.stdValue},
      ${stats} > div:nth-child(-n+2) ${SELECTORS.cptValue} {
        font-size: 1.2rem !important;
      }
    `;
    document.head.appendChild(styleElement);
  }

  destroy() {
    this.log('info', 'Destroying...');
    this.active = false;
    if (HAS_ABORT_CONTROLLER && this.abortController) this.abortController.abort();
    this.fetchRequest = null;
    this.abortController = null;

    this.clearAllTimers();
    this.observers.forEach(obs => {
      obs.disconnect();
    });
    this.observers.clear();

    this.stopBodyPoll();

    if (this.focusListenerActive) {
      document.removeEventListener('focusin', this.handleFocusIn, { capture: true });
      this.focusListenerActive = false;
    }

    document.querySelectorAll(`${SELECTORS.panel} #ryd-dislike-factoid`).forEach(el => {
      el.remove();
    });
    this.dislikeValueElement = null;
    this.dislikeFactoidElement = null;
    if (window.returnYouTubeDislike === this) {
      const styles = document.getElementById('ryd-persistent-styles');
      if (styles) styles.remove();
    }

    // Cleanup references
    this.panelElement = null;
    this.cachedMode = null;
  }
}

// --- Global Management ---
if (typeof window !== 'undefined') {
  window.returnYouTubeDislike = null;

  const cleanup = () => {
    if (window.returnYouTubeDislike) {
      window.returnYouTubeDislike.destroy();
      window.returnYouTubeDislike = null;
    }
  };

  const handleHashChange = () => {
    const urlStr = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!urlStr) {
      cleanup();
      return;
    }
    const url = new URL(urlStr, location.href);
    if (url.pathname !== '/watch' || !url.searchParams.get('v')) {
      cleanup();
      return;
    }

    if (
      !window.returnYouTubeDislike ||
      window.returnYouTubeDislike.videoID !== url.searchParams.get('v')
    ) {
      cleanup();
      let enabled = true;
      if (typeof configRead === 'function') {
        try {
          enabled = configRead('enableReturnYouTubeDislike');
        } catch {
          /* ignore */
        }
      }
      if (!enabled) return;
      window.returnYouTubeDislike = new ReturnYouTubeDislike(url.searchParams.get('v'));
      window.returnYouTubeDislike.init();
    }
  };

  window.addEventListener('hashchange', handleHashChange, { passive: true });
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(handleHashChange, 500));
  } else {
    setTimeout(handleHashChange, 500);
  }
  if (typeof configAddChangeListener === 'function') {
    configAddChangeListener('enableReturnYouTubeDislike', _evt => {
      cleanup();
      handleHashChange();
    });
  }
  window.addEventListener('beforeunload', cleanup, { passive: true });
}

export { ReturnYouTubeDislike };
