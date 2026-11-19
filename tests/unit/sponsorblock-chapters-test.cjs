/**
 * SponsorBlock's chapterBarRanges as a unit: where a segment sits on a progress bar that YouTube
 * draws as one child per chapter with margins between them. No chapters gives null (the plain
 * time-to-percent mapping then), one chapter is that plain mapping, a later chapter is shifted by
 * the margins before it, a segment across a gap is cut into one range per chapter, and a segment
 * past the video's end is clipped.
 *
 * Run: node tests/unit/sponsorblock-chapters-test.cjs
 */
'use strict';

const path = require('path');
const { createReport } = require('../harness/report.cjs');
const { SRC } = require('../harness/stubs.cjs');
const { loadSources } = require('../harness/sandbox.cjs');

const report = createReport();
const t = report.check;
const eq = report.eq;
const near = report.near;

// No layout here: a child carries its computed margins, and getComputedStyle hands them back.
const { sandbox } = loadSources([path.join(SRC, 'features', 'sponsorblock', 'overlay.js')], {
  getComputedStyle: (el) => el.computed
});
const { chapterBarRanges } = sandbox;

/**
 * A bar child: `key` its idomkey, `width` inline (a string such as '100px') or laid out (a
 * number, as offsetWidth), `ml` / `mr` its margins in px.
 */
function child(key, width, ml, mr) {
  return {
    getAttribute: (name) => (name === 'idomkey' ? key : null),
    style: { width: typeof width === 'string' ? width : '' },
    offsetWidth: typeof width === 'number' ? width : 0,
    computed: { marginLeft: (ml || 0) + 'px', marginRight: (mr || 0) + 'px' }
  };
}
const track = (...children) => ({ children });

// ---- no chapters ----
{
  eq('a track without children gives null', chapterBarRanges(track(), 10, 20, 100), null);
  eq(
    'children that are not chapters give null',
    chapterBarRanges(track(child('segment', 50), child('slider', 10)), 10, 20, 100),
    null
  );
  eq(
    'chapter children that are all zero wide give null',
    chapterBarRanges(track(child('chapter-0', 0), child('chapter-1', '0px')), 10, 20, 100),
    null
  );
}

// ---- one chapter, no margins: the plain mapping ----
{
  const ranges = chapterBarRanges(track(child('chapter-0', '500px')), 30, 60, 300);
  eq('one chapter gives one range', ranges.length, 1);
  near('its left is start / duration', ranges[0].left, (30 / 300) * 100);
  near('its width is the length / duration', ranges[0].width, (30 / 300) * 100);
}

// ---- two chapters, a 4px gap between them ----
// Chapter 1 is 100px for [0, 100] s, chapter 2 300px for [100, 400] s: 1px per second of
// content, and 404px laid out. Chapter 1's width comes from layout (offsetWidth), chapter 2's
// from its inline style; the other children of the track are not chapters and take no room.
{
  const bar = track(
    child('chapter-0', 100, 0, 3),
    child('segment', 999),
    child('chapter-1', '300px', 1, 0)
  );
  const pct = (px) => (px * 100) / 404;

  const inside = chapterBarRanges(bar, 200, 250, 400);
  eq('a segment inside chapter 2 gives one range', inside.length, 1);
  near("it is shifted right by chapter 1's margins", inside[0].left, pct(200 + 4));
  near('its width is its length, unstretched', inside[0].width, pct(50));
  t(
    'the plain mapping would have drawn it to the left of that',
    (200 / 400) * 100 < inside[0].left,
    String(inside[0].left)
  );

  const first = chapterBarRanges(bar, 10, 40, 400);
  near('a segment inside chapter 1 is not shifted', first[0].left, pct(10));

  const across = chapterBarRanges(bar, 80, 130, 400);
  eq('a segment across the gap gives one range per chapter', across.length, 2);
  near('the first range ends at the end of chapter 1', across[0].left + across[0].width, pct(100));
  near('the second starts at the start of chapter 2, past the gap', across[1].left, pct(104));
  near(
    'together they cover exactly the segment, 50 s at 1px per second',
    across[0].width + across[1].width,
    pct(50)
  );
  near('the first range starts at the segment start', across[0].left, pct(80));

  const past = chapterBarRanges(bar, 380, 450, 400);
  eq('a segment running past the end gives one range', past.length, 1);
  near(
    'it is clipped at the video end, the right edge of the bar',
    past[0].left + past[0].width,
    100
  );
  near('from its start', past[0].left, pct(384));

  eq(
    'a segment wholly past the end gives no range',
    chapterBarRanges(bar, 410, 420, 400).length,
    0
  );
}

report.finish();
