/**
 * Launch-URL handling, split out of utils.js.
 *
 * index.js is the tiny bootstrap page that only redirects to youtube.com/tv. It used to
 * import utils.js for these two functions, which dragged in the page-state
 * MutationObserver, the <video> cache and the REMOTE_KEYS build -- all module-level side
 * effects that run on a page with no YouTube in it. utils.js re-exports from here so the
 * userscript's existing import sites are unchanged.
 */

const CONTENT_INTENT_REGEX = /^.+(?=Content)/;

let cachedLaunchParams = null;

export function extractLaunchParams() {
  if (cachedLaunchParams) return cachedLaunchParams;

  if (window.launchParams) {
    try {
      cachedLaunchParams = JSON.parse(window.launchParams);
      return cachedLaunchParams;
    } catch (e) {
      console.warn('Failed to parse launchParams', e);
    }
  }
  return (cachedLaunchParams = {});
}

function getYTURL() {
  const ytURL = new URL('https://www.youtube.com/tv#/');
  ytURL.searchParams.set('env_forceFullAnimation', '1');
  ytURL.searchParams.set('env_enableWebSpeech', '1');
  ytURL.searchParams.set('env_enableVoice', '1');
  return ytURL;
}

function concatSearchParams(a, b) {
  b.forEach((value, key) => {
    a.append(key, value);
  });
  return a;
}

/**
 * A prefix match on the origin is not an origin check: `https://www.youtube.com.evil.test/x`
 * starts with `https://www.youtube.com` and would have been assigned to location.href.
 */
function sameOriginURL(candidate, expectedOrigin) {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return parsed.origin === expectedOrigin ? parsed : null;
}

export function handleLaunch(params) {
  console.info('handleLaunch', params);
  let ytURL = getYTURL();

  // Launch params come from the TV's voice/launcher stack -- treat them as untrusted input.
  // Any malformed shape falls back to the plain YouTube URL instead of leaving the app on a
  // blank page.
  try {
    let { target, contentTarget = target } = params;

    if (typeof contentTarget === 'string') {
      const sameOrigin = sameOriginURL(contentTarget, ytURL.origin);
      if (sameOrigin) {
        ytURL = sameOrigin;
      } else {
        if (contentTarget.startsWith('v=v=')) contentTarget = contentTarget.substring(2);

        concatSearchParams(ytURL.searchParams, new URLSearchParams(contentTarget));
      }
    } else if (contentTarget && typeof contentTarget === 'object') {
      const { intent, intentParam } = contentTarget;
      const search = ytURL.searchParams;
      // An intent-less voice launch still carries a usable intentParam, so the branch runs
      // either way; only the `va` hint depends on the intent being a string.
      const voiceContentIntent =
        typeof intent === 'string'
          ? intent.match(CONTENT_INTENT_REGEX)?.[0]?.toLowerCase()
          : undefined;

      search.set('inApp', true);
      search.set('vs', 9);
      if (voiceContentIntent) search.set('va', voiceContentIntent);
      search.append('launch', 'voice');
      if (voiceContentIntent === 'search') search.append('launch', 'search');
      search.set('vq', intentParam);
    }

    if (ytURL.searchParams.get('theme') === 'k') {
      ytURL.searchParams.delete('env_forceFullAnimation');
      ytURL.searchParams.delete('env_enableWebSpeech');
      ytURL.searchParams.delete('env_enableVoice');
    }
  } catch (err) {
    console.error('[Launch] handleLaunch failed to parse launch params:', err);
    ytURL = getYTURL();
  }

  window.location.href = ytURL.toString();
}
