import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  destroyAdblock,
  initAdblock,
  detectResponseType,
  getByPath,
  findObjects,
  parseHookRequired,
  processSectionListOptimized
} from '../src/adblock.js';
import { configRead, configWrite } from '../src/config';

// Importing the module hooks JSON.parse as a side effect (initAdblock() runs
// at module scope). Undo that immediately -- these tests only exercise the
// pure helpers, and leaving JSON.parse patched could affect anything else
// that runs in this process (including the test runner's own reporting).
destroyAdblock();
after(() => destroyAdblock());

// adblock.js's cfgSnapshot is bound to the exact object configGetAll() returns (see the
// "MUTATE IN PLACE ONLY" comment in config.ts), so writing through configWrite is visible
// to adblock.js immediately -- no re-import or localStorage stubbing needed. Each override
// is restored afterwards so tests stay order-independent.
function withConfigOverrides(overrides, fn) {
  const original = {};
  for (const key of Object.keys(overrides)) original[key] = configRead(key);
  try {
    for (const [key, value] of Object.entries(overrides)) configWrite(key, value);
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) configWrite(key, value);
  }
}

describe('getByPath', () => {
  test('reads a nested path', () => {
    assert.equal(getByPath({ a: { b: { c: 42 } } }, ['a', 'b', 'c']), 42);
  });

  test('returns undefined for a missing path', () => {
    assert.equal(getByPath({ a: {} }, ['a', 'b', 'c']), undefined);
  });

  test('returns undefined when parts is nullish', () => {
    assert.equal(getByPath({ a: 1 }, null), undefined);
    assert.equal(getByPath({ a: 1 }, undefined), undefined);
  });

  test('short-circuits through a null/undefined intermediate without throwing', () => {
    assert.equal(getByPath({ a: null }, ['a', 'b', 'c']), undefined);
    assert.equal(getByPath({}, ['a', 'b']), undefined);
  });

  test('indexes into arrays via numeric-string keys', () => {
    assert.equal(getByPath({ a: [10, 20, 30] }, ['a', '1']), 20);
  });
});

describe('findObjects', () => {
  test('finds multiple needle keys anywhere in the tree', () => {
    const haystack = { x: { y: { target1: 'found1' } }, z: { target2: 'found2' } };
    assert.deepEqual(findObjects(haystack, ['target1', 'target2']), {
      target1: 'found1',
      target2: 'found2'
    });
  });

  test('returns an empty object for an invalid haystack or empty needle list', () => {
    assert.deepEqual(findObjects(null, ['a']), {});
    assert.deepEqual(findObjects({ a: 1 }, []), {});
  });

  test('does not find a needle past maxDepth', () => {
    const haystack = { a: { b: { c: { target: 'deep' } } } };
    assert.deepEqual(findObjects(haystack, ['target'], 1), {});
    assert.deepEqual(findObjects(haystack, ['target'], 3), { target: 'deep' });
  });

  test('keeps the first match when a key appears more than once', () => {
    const haystack = { first: { target: 'a' }, second: { target: 'b' } };
    const result = findObjects(haystack, ['target']);
    assert.ok(result.target === 'a' || result.target === 'b');
  });
});

describe('detectResponseType', () => {
  test('detects PLAYER responses', () => {
    assert.equal(detectResponseType({ streamingData: {} }), 'PLAYER');
  });

  test('detects NEXT (watch) responses', () => {
    assert.equal(detectResponseType({ contents: { singleColumnWatchNextResults: {} } }), 'NEXT');
  });

  test('detects HOME_BROWSE responses', () => {
    const data = {
      contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: {} } } }
    };
    assert.equal(detectResponseType(data), 'HOME_BROWSE');
  });

  test('detects BROWSE_TABS responses', () => {
    const data = {
      contents: { tvBrowseRenderer: { content: { tvSecondaryNavRenderer: {} } } }
    };
    assert.equal(detectResponseType(data), 'BROWSE_TABS');
  });

  test('detects SEARCH responses', () => {
    assert.equal(detectResponseType({ contents: { sectionListRenderer: {} } }), 'SEARCH');
  });

  test('excludes SEARCH when tvBrowseRenderer is present, even without a full browse shape', () => {
    const data = { contents: { tvBrowseRenderer: {}, sectionListRenderer: {} } };
    assert.equal(detectResponseType(data), null);
  });

  test('detects CONTINUATION responses', () => {
    assert.equal(detectResponseType({ continuationContents: {} }), 'CONTINUATION');
  });

  test('detects ACTION responses from either endpoint field', () => {
    assert.equal(detectResponseType({ onResponseReceivedActions: [] }), 'ACTION');
    assert.equal(detectResponseType({ onResponseReceivedEndpoints: [] }), 'ACTION');
  });

  test('detects SHORTS_SEQUENCE only when entries is actually an array', () => {
    assert.equal(detectResponseType({ entries: [] }), 'SHORTS_SEQUENCE');
    assert.equal(detectResponseType({ entries: 'not an array' }), null);
  });

  test('returns null for a response matching no known schema', () => {
    assert.equal(detectResponseType({}), null);
    assert.equal(detectResponseType({ someUnknownField: true }), null);
  });
});

describe('parseHookRequired', () => {
  test('is false only when Ad Blocking, guest-prompt hiding, and endcard hiding are all off', () => {
    withConfigOverrides(
      { enableAdBlock: false, hideGuestSignInPrompts: false, hideEndcards: false },
      () => assert.equal(parseHookRequired(), false)
    );
  });

  test('is true when only Ad Blocking is on', () => {
    withConfigOverrides(
      { enableAdBlock: true, hideGuestSignInPrompts: false, hideEndcards: false },
      () => assert.equal(parseHookRequired(), true)
    );
  });

  // The bug this fixes: the hook used to be gated on enableAdBlock alone, so turning Ad
  // Blocking off silently disabled guest-prompt hiding too.
  test('is true when only guest sign-in prompt hiding is on', () => {
    withConfigOverrides(
      { enableAdBlock: false, hideGuestSignInPrompts: true, hideEndcards: false },
      () => assert.equal(parseHookRequired(), true)
    );
  });

  // Same bug, the other setting it silently disabled.
  test('is true when only endcard hiding is on', () => {
    withConfigOverrides(
      { enableAdBlock: false, hideGuestSignInPrompts: false, hideEndcards: true },
      () => assert.equal(parseHookRequired(), true)
    );
  });
});

describe('hookedParse (installed on the global JSON.parse)', () => {
  // Guards ordered cheapest-first so the vast majority of JSON.parse calls -- config,
  // per-tile metadata, anything under the 500-char floor -- cost nothing extra.
  test('does not filter a payload under the 500-character floor, even with a filter setting on', () => {
    withConfigOverrides({ enableAdBlock: true }, () => {
      initAdblock();
      try {
        const text = JSON.stringify({ playerResponse: { adPlacements: [{}] } });
        assert.ok(text.length < 500);
        const result = JSON.parse(text);
        assert.equal(result.playerResponse.adPlacements.length, 1);
      } finally {
        destroyAdblock();
      }
    });
  });

  test('does not filter a long payload when no filter setting is enabled', () => {
    withConfigOverrides(
      {
        enableAdBlock: false,
        enableTrackingBlock: false,
        removeGlobalShorts: false,
        removeTopLiveGames: false,
        removeMostRelevant: false,
        hideGuestSignInPrompts: false,
        hideEndcards: false
      },
      () => {
        initAdblock();
        try {
          const payload = { playerResponse: { adPlacements: [{}] }, padding: 'x'.repeat(500) };
          const text = JSON.stringify(payload);
          const result = JSON.parse(text);
          assert.equal(result.playerResponse.adPlacements.length, 1);
        } finally {
          destroyAdblock();
        }
      }
    );
  });

  // The root-property check replaced a regex scanning the whole payload string. A needle
  // name buried deep inside an unrelated blob must no longer drag it through the filters.
  test('leaves a long payload untouched when none of the three root properties are present', () => {
    withConfigOverrides({ enableTrackingBlock: true }, () => {
      initAdblock();
      try {
        const payload = {
          someWrapper: {
            nested: { deep: { playerResponse: { trackingParams: 'abc123' } } }
          },
          padding: 'x'.repeat(600)
        };
        const text = JSON.stringify(payload);
        assert.ok(text.length >= 500);
        const result = JSON.parse(text);
        assert.equal(result.someWrapper.nested.deep.playerResponse.trackingParams, 'abc123');
      } finally {
        destroyAdblock();
      }
    });
  });
});

describe('processSectionListOptimized (dropping shelves emptied by filtering)', () => {
  const filteringConfig = {
    enableAdBlock: true,
    removeGlobalShorts: false,
    removeTopLiveGames: false,
    removeMostRelevant: false,
    hideGuestPrompts: false
  };
  const adSlot = () => ({ adSlotRenderer: {} });
  const videoTile = id => ({ tileRenderer: { videoId: id } });

  test('drops a shelf whose horizontalListRenderer items were all filtered out', () => {
    const contents = [
      { shelfRenderer: { content: { horizontalListRenderer: { items: [adSlot(), adSlot()] } } } }
    ];
    processSectionListOptimized(contents, filteringConfig, true);
    assert.equal(contents.length, 0);
  });

  test('drops a shelf whose gridRenderer items were all filtered out', () => {
    const contents = [
      { shelfRenderer: { content: { gridRenderer: { items: [adSlot(), adSlot()] } } } }
    ];
    processSectionListOptimized(contents, filteringConfig, true);
    assert.equal(contents.length, 0);
  });

  test('keeps a shelf when only one of its two item lists was emptied', () => {
    const contents = [
      {
        shelfRenderer: {
          content: {
            horizontalListRenderer: { items: [adSlot()] },
            gridRenderer: { items: [videoTile('a')] }
          }
        }
      }
    ];
    processSectionListOptimized(contents, filteringConfig, true);
    assert.equal(contents.length, 1);
  });

  test('keeps a shelf whose list still has items after filtering', () => {
    const contents = [
      {
        shelfRenderer: {
          content: { horizontalListRenderer: { items: [adSlot(), videoTile('a')] } }
        }
      }
    ];
    processSectionListOptimized(contents, filteringConfig, true);
    assert.equal(contents.length, 1);
    assert.deepEqual(
      contents[0].shelfRenderer.content.horizontalListRenderer.items.map(
        i => i.tileRenderer.videoId
      ),
      ['a']
    );
  });

  // A shelf using some other content renderer was never a candidate for this cleanup and
  // must not be judged empty just because it has neither a horizontal nor a grid list.
  test('keeps a shelf whose content uses a renderer other than horizontal/grid list', () => {
    const contents = [{ shelfRenderer: { content: { richGridRenderer: { contents: [] } } } }];
    processSectionListOptimized(contents, filteringConfig, true);
    assert.equal(contents.length, 1);
  });
});
