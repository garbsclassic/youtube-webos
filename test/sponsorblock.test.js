import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorBlockHandler } from '../src/sponsorblock.js';

const { findSegmentAtTime, findNextSegmentIndex, buildSkipChain } = SponsorBlockHandler.prototype;

describe('findSegmentAtTime (binary search)', () => {
  const skipSegments = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 30, end: 40 }
  ];

  test('returns -1 when there are no segments', () => {
    assert.equal(findSegmentAtTime.call({ skipSegments: [] }, 5), -1);
  });

  test('finds the segment containing the given time', () => {
    assert.equal(findSegmentAtTime.call({ skipSegments }, 5), 0);
    assert.equal(findSegmentAtTime.call({ skipSegments }, 15), 1);
    assert.equal(findSegmentAtTime.call({ skipSegments }, 35), 2);
  });

  test('returns -1 for a time in a gap between segments', () => {
    assert.equal(findSegmentAtTime.call({ skipSegments }, 25), -1);
  });

  test('treats the segment end as exclusive', () => {
    assert.equal(findSegmentAtTime.call({ skipSegments }, 10), 1);
  });
});

describe('findNextSegmentIndex (binary search)', () => {
  const skipSegments = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 30, end: 40 }
  ];

  test('finds the first segment starting at or after the given time', () => {
    assert.equal(findNextSegmentIndex.call({ skipSegments }, 0), 0);
    assert.equal(findNextSegmentIndex.call({ skipSegments }, 5), 1);
    assert.equal(findNextSegmentIndex.call({ skipSegments }, 30), 2);
  });

  test('returns segments.length when nothing starts at or after the given time', () => {
    assert.equal(findNextSegmentIndex.call({ skipSegments }, 35), 3);
  });
});

describe('buildSkipChain', () => {
  test('returns null with no segments', () => {
    assert.equal(buildSkipChain([]), null);
    assert.equal(buildSkipChain(null), null);
  });

  test('returns null when the video does not open on an auto-skip segment', () => {
    // First segment starts past the "beginning of the video" threshold.
    const segments = [{ start: 1.0, end: 5, mode: 'auto_skip', category: 'sponsor' }];
    assert.equal(buildSkipChain(segments), null);
  });

  test('returns null when the first segment at the start is a manual skip', () => {
    const segments = [{ start: 0, end: 5, mode: 'manual_skip', category: 'sponsor' }];
    assert.equal(buildSkipChain(segments), null);
  });

  test('returns null for a single leading segment shorter than 1 second', () => {
    const segments = [{ start: 0, end: 0.5, mode: 'auto_skip', category: 'sponsor' }];
    assert.equal(buildSkipChain(segments), null);
  });

  test('builds a single-segment chain', () => {
    const segments = [{ start: 0, end: 5, mode: 'auto_skip', category: 'sponsor' }];
    assert.deepEqual(buildSkipChain(segments), {
      endTime: 5,
      chainDescription: 'sponsor[0.0s-5.0s]'
    });
  });

  test('chains adjacent auto-skip segments within the overlap tolerance', () => {
    const segments = [
      { start: 0, end: 5, mode: 'auto_skip', category: 'sponsor' },
      { start: 5.1, end: 10, mode: 'auto_skip', category: 'intro' }
    ];
    assert.deepEqual(buildSkipChain(segments), {
      endTime: 10,
      chainDescription: 'sponsor[0.0s-5.0s] → intro[5.1s-10.0s]'
    });
  });

  test('stops the chain when the gap to the next segment exceeds the overlap tolerance', () => {
    const segments = [
      { start: 0, end: 5, mode: 'auto_skip', category: 'sponsor' },
      { start: 6, end: 10, mode: 'auto_skip', category: 'intro' }
    ];
    assert.deepEqual(buildSkipChain(segments), {
      endTime: 5,
      chainDescription: 'sponsor[0.0s-5.0s]'
    });
  });

  test('skips a manual-skip segment that starts after the chain already ends', () => {
    const segments = [
      { start: 0, end: 5, mode: 'auto_skip', category: 'sponsor' },
      { start: 7, end: 9, mode: 'manual_skip', category: 'intro' }
    ];
    assert.deepEqual(buildSkipChain(segments), {
      endTime: 5,
      chainDescription: 'sponsor[0.0s-5.0s]'
    });
  });

  test('truncates the chain end time at a manual-skip segment inside it, without updating the description', () => {
    // Documents current behavior: the description still names the original
    // segment bounds even though endTime was pulled back to the manual-skip
    // segment's start.
    const segments = [
      { start: 0, end: 10, mode: 'auto_skip', category: 'sponsor' },
      { start: 8, end: 15, mode: 'manual_skip', category: 'intro' }
    ];
    assert.deepEqual(buildSkipChain(segments), {
      endTime: 8,
      chainDescription: 'sponsor[0.0s-10.0s]'
    });
  });
});
