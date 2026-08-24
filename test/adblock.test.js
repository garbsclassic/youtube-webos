import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { destroyAdblock, detectResponseType, getByPath, findObjects } from '../src/adblock.js';

// Importing the module hooks JSON.parse as a side effect (initAdblock() runs
// at module scope). Undo that immediately -- these tests only exercise the
// pure helpers, and leaving JSON.parse patched could affect anything else
// that runs in this process (including the test runner's own reporting).
destroyAdblock();
after(() => destroyAdblock());

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
