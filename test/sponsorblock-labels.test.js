import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime,
  cssString,
  safeColor,
  contrastColor,
  categoryColor,
  isFullVideoSegment,
  skippableSeconds,
  pickFullLabel,
  buildCss
} from '../src/sponsorblock-labels.js';
import sponsorBlockLabels from '../src/sponsorblock-labels.js';
import { configRead, configWrite, configGetDefault } from '../src/config';

// config.ts hands out one shared live object, so every key a test writes is reset to its
// default afterwards to keep tests order-independent.
const touched = new Set();

function setConfig(key, value) {
  touched.add(key);
  configWrite(key, value);
}

afterEach(() => {
  for (const key of touched) configWrite(key, configGetDefault(key));
  touched.clear();
});

const skip = (category, start, end, extra = {}) => ({
  category,
  actionType: 'skip',
  segment: [start, end],
  ...extra
});
const full = category => ({ category, actionType: 'full', segment: [0, 0] });

describe('formatTime', () => {
  test('formats under an hour as m:ss without a leading zero on minutes', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(5), '0:05');
    assert.equal(formatTime(621), '10:21');
    assert.equal(formatTime(3599), '59:59');
  });

  test('formats an hour or more as h:mm:ss', () => {
    assert.equal(formatTime(3600), '1:00:00');
    assert.equal(formatTime(3661), '1:01:01');
    assert.equal(formatTime(36000 + 59 * 60 + 9), '10:59:09');
  });

  test('rounds fractional seconds to the nearest second', () => {
    assert.equal(formatTime(59.4), '0:59');
    assert.equal(formatTime(59.6), '1:00');
  });

  test('clamps negative values to 0:00', () => {
    assert.equal(formatTime(-30), '0:00');
    assert.equal(formatTime(-0.4), '0:00');
  });
});

describe('cssString', () => {
  test('wraps a plain value in double quotes', () => {
    assert.equal(cssString('Sponsor'), '"Sponsor"');
  });

  test('escapes quotes and backslashes so the string cannot be closed early', () => {
    assert.equal(cssString('a"}body{x'), '"a\\"}body{x"');
    assert.equal(cssString('a\\b'), '"a\\\\b"');
    // A trailing backslash must not escape the closing quote.
    assert.equal(cssString('end\\'), '"end\\\\"');
  });

  test('replaces CR and LF with spaces', () => {
    assert.equal(cssString('a\r\nb\nc\rd'), '"a  b c d"');
  });
});

describe('safeColor', () => {
  test('accepts #rgb and #rrggbb in any case and trims whitespace', () => {
    assert.equal(safeColor('#abc', '#000'), '#abc');
    assert.equal(safeColor('#ABCDEF', '#000'), '#ABCDEF');
    assert.equal(safeColor('  #00d400 \n', '#000'), '#00d400');
  });

  test('returns the fallback for anything that is not a short or long hex colour', () => {
    for (const bad of ['red', '#12345', '#1234567', '#fff;}', 'url(x)', '', '#ggg', 'fff']) {
      assert.equal(safeColor(bad, '#123456'), '#123456', bad);
    }
  });

  test('returns the fallback for null and undefined', () => {
    assert.equal(safeColor(null, '#111'), '#111');
    assert.equal(safeColor(undefined, '#111'), '#111');
  });
});

describe('contrastColor', () => {
  test('chooses black text on a light background', () => {
    assert.equal(contrastColor('#ffff00'), '#000');
    assert.equal(contrastColor('#ffffff'), '#000');
  });

  test('chooses white text on a dark background', () => {
    assert.equal(contrastColor('#0202ed'), '#fff');
    assert.equal(contrastColor('#000000'), '#fff');
  });

  test('chooses white text for invalid input', () => {
    assert.equal(contrastColor('red'), '#fff');
    assert.equal(contrastColor(''), '#fff');
    assert.equal(contrastColor(undefined), '#fff');
  });
});

describe('categoryColor', () => {
  test('returns the default colour of a configurable category', () => {
    assert.equal(categoryColor('sponsor'), '#00d400');
    assert.equal(categoryColor('selfpromo'), '#ffff00');
  });

  test('returns the user-chosen colour when it is a valid hex colour', () => {
    setConfig('sponsorColor', '#123abc');
    assert.equal(categoryColor('sponsor'), '#123abc');
  });

  test('falls back to green when the stored colour is not a hex colour', () => {
    setConfig('sponsorColor', 'red;}');
    assert.equal(categoryColor('sponsor'), '#00d400');
  });

  test('uses the built-in colour for exclusive_access, which has no config key', () => {
    assert.equal(categoryColor('exclusive_access'), '#008a5c');
  });

  test('returns green for an unknown category without throwing', () => {
    assert.equal(categoryColor('bogus'), '#00d400');
  });
});

describe('isFullVideoSegment', () => {
  test('is true only for actionType full', () => {
    assert.equal(isFullVideoSegment(full('sponsor')), true);
    assert.equal(isFullVideoSegment(skip('sponsor', 1, 2)), false);
    assert.equal(isFullVideoSegment({ category: 'sponsor', actionType: 'mute' }), false);
    assert.equal(isFullVideoSegment({ category: 'sponsor', segment: [0, 0] }), false);
  });

  test('is false for null and undefined', () => {
    assert.equal(isFullVideoSegment(null), false);
    assert.equal(isFullVideoSegment(undefined), false);
  });
});

describe('skippableSeconds', () => {
  test('returns 0 for empty and null input', () => {
    assert.equal(skippableSeconds([], 100), 0);
    assert.equal(skippableSeconds(null, 100), 0);
    assert.equal(skippableSeconds(undefined, 100), 0);
  });

  test('sums non-overlapping segments', () => {
    assert.equal(skippableSeconds([skip('sponsor', 10, 20), skip('intro', 30, 45)], 100), 25);
  });

  test('counts overlapping ranges once', () => {
    const segments = [skip('sponsor', 629, 741), skip('selfpromo', 740, 751)];
    assert.equal(skippableSeconds(segments, 0), 122);
  });

  test('merges overlaps regardless of input order and absorbs a contained range', () => {
    const segments = [skip('intro', 50, 60), skip('sponsor', 10, 100), skip('outro', 0, 20)];
    assert.equal(skippableSeconds(segments, 0), 100);
  });

  test('treats touching ranges as one continuous range', () => {
    assert.equal(skippableSeconds([skip('sponsor', 10, 20), skip('intro', 20, 30)], 0), 20);
  });

  test('excludes mute and full actions', () => {
    const segments = [
      skip('sponsor', 10, 20, { actionType: 'mute' }),
      skip('sponsor', 30, 40, { actionType: 'full' }),
      skip('sponsor', 50, 55)
    ];
    assert.equal(skippableSeconds(segments, 100), 5);
  });

  test('counts a segment with no actionType as a skip', () => {
    assert.equal(skippableSeconds([{ category: 'sponsor', segment: [10, 20] }], 100), 10);
  });

  test('excludes poi_highlight and chapter categories', () => {
    const segments = [
      skip('poi_highlight', 10, 20),
      skip('chapter', 30, 40),
      skip('sponsor', 50, 53)
    ];
    assert.equal(skippableSeconds(segments, 100), 3);
  });

  test('excludes a category whose mode is disable', () => {
    setConfig('sbMode_sponsor', 'disable');
    assert.equal(skippableSeconds([skip('sponsor', 10, 20), skip('intro', 30, 35)], 100), 5);
  });

  test('includes categories in seek_bar and manual_skip modes', () => {
    setConfig('sbMode_sponsor', 'seek_bar');
    setConfig('sbMode_intro', 'manual_skip');
    assert.equal(skippableSeconds([skip('sponsor', 10, 20), skip('intro', 30, 35)], 100), 15);
  });

  test('clamps ranges to the duration when duration is positive', () => {
    assert.equal(skippableSeconds([skip('sponsor', 90, 130)], 100), 10);
  });

  test('drops a range that starts at or past the duration', () => {
    assert.equal(skippableSeconds([skip('sponsor', 100, 130), skip('intro', 200, 210)], 100), 0);
  });

  test('does not clamp when duration is 0', () => {
    assert.equal(skippableSeconds([skip('sponsor', 90, 130)], 0), 40);
  });

  test('ignores NaN, reversed, empty and missing ranges', () => {
    const segments = [
      skip('sponsor', NaN, 20),
      skip('sponsor', 10, 'abc'),
      skip('sponsor', 30, 30),
      skip('sponsor', 50, 40),
      { category: 'sponsor', actionType: 'skip' },
      null,
      skip('sponsor', 60, 64)
    ];
    assert.equal(skippableSeconds(segments, 100), 4);
  });
});

describe('pickFullLabel', () => {
  test('returns null for empty and null input', () => {
    assert.equal(pickFullLabel([]), null);
    assert.equal(pickFullLabel(null), null);
  });

  test('prefers sponsor over selfpromo over exclusive_access regardless of order', () => {
    assert.equal(
      pickFullLabel([full('exclusive_access'), full('selfpromo'), full('sponsor')]),
      'sponsor'
    );
    assert.equal(pickFullLabel([full('exclusive_access'), full('selfpromo')]), 'selfpromo');
    assert.equal(pickFullLabel([full('exclusive_access')]), 'exclusive_access');
  });

  test('ignores segments that are not full-video labels', () => {
    assert.equal(pickFullLabel([skip('sponsor', 10, 20), full('selfpromo')]), 'selfpromo');
    assert.equal(pickFullLabel([skip('sponsor', 10, 20)]), null);
  });

  test('skips a disabled category so the next priority wins', () => {
    setConfig('sbMode_sponsor', 'disable');
    assert.equal(pickFullLabel([full('sponsor'), full('selfpromo')]), 'selfpromo');
    assert.equal(pickFullLabel([full('sponsor')]), null);
  });

  test('returns null for a full category that has no label', () => {
    assert.equal(pickFullLabel([full('filler')]), null);
    assert.equal(pickFullLabel([full('bogus')]), null);
  });
});

describe('buildCss', () => {
  test('is empty when both settings are off, even with labels and skips present', () => {
    const segments = [full('sponsor'), skip('intro', 10, 70)];
    assert.equal(buildCss(segments, 750), '');
  });

  test('emits the badge with its background and contrast colour for a full sponsor segment', () => {
    setConfig('sbFullVideoLabel', true);
    const css = buildCss([full('sponsor')], 750);
    assert.match(css, /::before\{content:"Sponsor";background-color:#00d400;color:#fff;\}/);
    assert.ok(css.includes('ytlr-watch-metadata [idomkey="title-text"]::before'));
  });

  test('uses dark text on the yellow self-promo badge and the human-readable name', () => {
    setConfig('sbFullVideoLabel', true);
    const css = buildCss([full('selfpromo')], 750);
    assert.match(css, /content:"Self Promo";background-color:#ffff00;color:#000;/);
  });

  test('labels exclusive access with its built-in colour', () => {
    setConfig('sbFullVideoLabel', true);
    const css = buildCss([full('exclusive_access')], 750);
    assert.match(css, /content:"Exclusive Access";background-color:#008a5c;color:#fff;/);
  });

  test('emits no badge when the setting is on but no full-video label exists', () => {
    setConfig('sbFullVideoLabel', true);
    assert.equal(buildCss([skip('sponsor', 10, 20)], 750), '');
  });

  test('emits the time with skips removed after the duration', () => {
    setConfig('sbShowTimeWithSkips', true);
    // 60 s + 69 s skipped = 129 s; 750 - 129 = 621 s = 10:21.
    const segments = [skip('sponsor', 10, 70), skip('intro', 300, 369)];
    assert.equal(
      buildCss(segments, 750),
      '[idomkey="time-label"] [idomkey="duration"]::after{content:"(10:21)";}'
    );
  });

  test('counts overlapping skips once in the displayed time', () => {
    setConfig('sbShowTimeWithSkips', true);
    const segments = [skip('sponsor', 100, 200), skip('selfpromo', 150, 250)];
    assert.match(buildCss(segments, 600), /content:"\(7:30\)";/);
  });

  test('emits no time rule when under one second would be skipped', () => {
    setConfig('sbShowTimeWithSkips', true);
    assert.equal(buildCss([skip('sponsor', 10, 10.9)], 750), '');
  });

  test('emits a time rule when exactly one second is skipped', () => {
    setConfig('sbShowTimeWithSkips', true);
    assert.match(buildCss([skip('sponsor', 10, 11)], 750), /content:"\(12:29\)";/);
  });

  test('emits no time rule when duration is 0 or NaN', () => {
    setConfig('sbShowTimeWithSkips', true);
    const segments = [skip('sponsor', 10, 70)];
    assert.equal(buildCss(segments, 0), '');
    assert.equal(buildCss(segments, NaN), '');
  });

  test('emits both rules when both settings are on', () => {
    setConfig('sbFullVideoLabel', true);
    setConfig('sbShowTimeWithSkips', true);
    const css = buildCss([full('sponsor'), skip('intro', 0, 60)], 600);
    assert.ok(css.includes('content:"Sponsor"'));
    assert.ok(css.includes('content:"(9:00)"'));
  });
});

describe('default labels singleton', () => {
  // The singleton keeps its style element between calls, so one fake document serves the whole
  // suite and the element it created stays observable.
  const appended = [];
  const originalDocument = globalThis.document;

  before(() => {
    globalThis.document = {
      head: {
        appendChild(el) {
          el.isConnected = true;
          appended.push(el);
        }
      },
      createElement: () => ({ id: '', textContent: '', isConnected: false })
    };
  });

  after(() => {
    sponsorBlockLabels.clear();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  test('update writes one style element with the built CSS and reuses it', () => {
    setConfig('sbShowTimeWithSkips', true);

    sponsorBlockLabels.update([skip('sponsor', 10, 70)], 600);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].id, 'sb-labels');
    assert.equal(
      appended[0].textContent,
      '[idomkey="time-label"] [idomkey="duration"]::after{content:"(9:00)";}'
    );

    sponsorBlockLabels.update([skip('sponsor', 10, 130)], 600);
    assert.equal(appended.length, 1);
    assert.match(appended[0].textContent, /content:"\(8:00\)"/);
  });

  test('clear empties the stylesheet text', () => {
    setConfig('sbShowTimeWithSkips', true);
    sponsorBlockLabels.update([skip('sponsor', 10, 70)], 600);
    assert.notEqual(appended[0].textContent, '');

    sponsorBlockLabels.clear();
    assert.equal(appended[0].textContent, '');
  });
});

test('config defaults leave both label features off', () => {
  assert.equal(configRead('sbFullVideoLabel'), false);
  assert.equal(configRead('sbShowTimeWithSkips'), false);
});
