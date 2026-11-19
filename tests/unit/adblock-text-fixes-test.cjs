/**
 * adblock/text-fixes as a unit: trackingParams blanking done on the JSON text
 * before the parse (every depth, the quick exit when the key is absent,
 * clickTrackingParams and escaped or non-string values left alone).
 *
 * Run: node tests/unit/adblock-text-fixes-test.cjs
 */
'use strict';

const path = require('path');
const { createReport } = require('../harness/report.cjs');
const { SRC } = require('../harness/stubs.cjs');
const { loadSources } = require('../harness/sandbox.cjs');
const { makeBrowse } = require('../harness/gen-payload.cjs');

const report = createReport();
const t = report.check;
const eq = report.eq;

const SOURCES = ['text-fixes.js'].map((f) => path.join(SRC, 'features', 'adblock', f));
const { sandbox } = loadSources(SOURCES, { log: { debug() {}, warn() {} } });
const { stripTrackingParams } = sandbox;

/** Every non-empty string trackingParams left in a tree, with the deepest one's depth. */
function leftover(obj) {
  let count = 0;
  let deepest = -1;
  (function walk(node, depth) {
    if (typeof node.trackingParams === 'string' && node.trackingParams) {
      count++;
      if (depth > deepest) deepest = depth;
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  })(obj, 0);
  return { count, deepest };
}

// ---- the quick exit ----
{
  const text = JSON.stringify({ responseContext: {}, contents: { a: [1, 2, 3] } });
  t('a text without the key comes back as the same string', stripTrackingParams(text) === text);
}

// ---- every depth, including past the old walk's limit of 14 ----
{
  let deep = { trackingParams: 'CAEQ_deep', title: { simpleText: 'x' } };
  for (let i = 0; i < 20; i++) deep = { child: deep, trackingParams: 'CAEQ_' + i };
  const root = { responseContext: {}, contents: deep, trackingParams: 'CAEQ_root' };
  const before = leftover(root);
  const out = JSON.parse(stripTrackingParams(JSON.stringify(root)));
  const after = leftover(out);
  eq('the fixture nests trackingParams 21 levels deep', before.deepest, 21);
  eq('every trackingParams is blanked, whatever its depth', after.count, 0);
  eq('the root one too', out.trackingParams, '');
  // InnerTube answers pretty-printed unless the request says prettyPrint=false.
  const pretty = JSON.parse(stripTrackingParams(JSON.stringify(root, null, 2)));
  eq('pretty-printed JSON (": " between key and value) is blanked too', leftover(pretty).count, 0);
  t('nothing else moved', JSON.stringify(out).indexOf('"simpleText":"x"') !== -1);
}

// ---- a generated browse response ----
{
  const text = JSON.stringify(makeBrowse({ shelves: 30, tilesPer: 20 }));
  const before = leftover(JSON.parse(text));
  const out = JSON.parse(stripTrackingParams(text));
  t(
    'setup: the generated browse carries trackingParams deeper than 14',
    before.deepest > 14,
    String(before.deepest)
  );
  eq('a browse response of 1263 trackingParams has none left', leftover(out).count, 0);
  eq(
    'the shelves are all still there',
    out.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
      (s) => s.shelfRenderer
    ).length,
    30
  );
}

// ---- what is left alone ----
{
  const root = {
    responseContext: {},
    clickTrackingParams: 'CAEQ_click',
    nested: { clickTrackingParams: 'CAEQ_nested', trackingParams: 'CAEQ_gone' },
    escaped: { trackingParams: 'has a ' + String.fromCharCode(92) + ' backslash' },
    quoted: { trackingParams: 'has a " quote' },
    object: { trackingParams: { not: 'a string' } },
    number: { trackingParams: 7 }
  };
  const out = JSON.parse(stripTrackingParams(JSON.stringify(root)));
  eq('clickTrackingParams at the root is kept', out.clickTrackingParams, 'CAEQ_click');
  eq(
    'clickTrackingParams beside a blanked trackingParams is kept',
    out.nested.clickTrackingParams,
    'CAEQ_nested'
  );
  eq('and that trackingParams is blanked', out.nested.trackingParams, '');
  eq(
    'a value with a backslash escape is left as it was',
    out.escaped.trackingParams,
    'has a ' + String.fromCharCode(92) + ' backslash'
  );
  eq('a value with an escaped quote is left as it was', out.quoted.trackingParams, 'has a " quote');
  eq(
    'an object value is left alone',
    JSON.stringify(out.object.trackingParams),
    '{"not":"a string"}'
  );
  eq('a number value is left alone', out.number.trackingParams, 7);
}

// ---- the tab renderers keep their own trackingParams (Subscriptions channel tabs) ----
{
  // A Subscriptions browse: the tab bar, three channel tabs, the first one's
  // content inline; strings with braces, brackets, escaped quotes and a
  // look-alike key in a value, which the scan must read as text.
  const tab = (n, content) => ({
    tabRenderer: {
      title: 'Channel {' + n + '} [x] "q"',
      content: {
        tvSurfaceContentRenderer: Object.assign({ trackingParams: 'SURF_' + n }, content)
      },
      trackingParams: 'TAB_' + n
    }
  });
  const shelf = {
    shelfRenderer: {
      title: { runs: [{ text: '"trackingParams":"fake" } ] {' }] },
      content: {
        horizontalListRenderer: {
          items: [{ tileRenderer: { trackingParams: 'TILE_1' } }],
          trackingParams: 'LIST_1'
        }
      },
      trackingParams: 'SHELF_1'
    }
  };
  const browse = {
    responseContext: {},
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSecondaryNavRenderer: {
            sections: [
              {
                tvSecondaryNavSectionRenderer: {
                  tabs: [
                    tab(1, { content: { sectionListRenderer: { contents: [shelf] } } }),
                    tab(2, {}),
                    tab(3, { continuation: { token: 'abc' } })
                  ]
                }
              }
            ]
          }
        },
        trackingParams: 'BROWSE'
      }
    },
    trackingParams: 'ROOT'
  };
  const text = JSON.stringify(browse);
  const out = JSON.parse(stripTrackingParams(text));
  const tabs =
    out.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[0]
      .tvSecondaryNavSectionRenderer.tabs;
  eq(
    'every tab surface keeps its own trackingParams',
    tabs.map((x) => x.tabRenderer.content.tvSurfaceContentRenderer.trackingParams).join(),
    'SURF_1,SURF_2,SURF_3'
  );
  eq(
    'the tabs themselves, the browse and the root are blanked',
    [
      tabs[0].tabRenderer.trackingParams,
      out.contents.tvBrowseRenderer.trackingParams,
      out.trackingParams
    ].join(),
    ',,'
  );
  const s1 =
    tabs[0].tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents[0]
      .shelfRenderer;
  eq(
    'inside a kept surface, its shelves, lists and tiles are blanked',
    [
      s1.trackingParams,
      s1.content.horizontalListRenderer.trackingParams,
      s1.content.horizontalListRenderer.items[0].tileRenderer.trackingParams
    ].join(),
    ',,'
  );
  eq(
    'a look-alike key inside a string stays text',
    s1.title.runs[0].text,
    '"trackingParams":"fake" } ] {'
  );
  eq(
    'titles with braces, brackets and quotes come through',
    tabs[1].tabRenderer.title,
    'Channel {2} [x] "q"'
  );

  // A tab's content loading later: the continuation keeps its own.
  const cont = {
    responseContext: {},
    continuationContents: {
      tvSurfaceContentContinuation: {
        content: { sectionListRenderer: { contents: [shelf] } },
        trackingParams: 'CONT_OWN'
      }
    },
    trackingParams: 'ROOT'
  };
  const outCont = JSON.parse(stripTrackingParams(JSON.stringify(cont, null, 2)));
  eq(
    'a tab continuation (pretty-printed) keeps its own trackingParams',
    outCont.continuationContents.tvSurfaceContentContinuation.trackingParams,
    'CONT_OWN'
  );
  eq(
    'and blanks everything inside it and the root',
    [
      outCont.trackingParams,
      outCont.continuationContents.tvSurfaceContentContinuation.content.sectionListRenderer
        .contents[0].shelfRenderer.trackingParams
    ].join(),
    ','
  );

  // The home browse has a surface but no tabs: the fast path, everything blanked.
  const home = {
    contents: {
      tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { trackingParams: 'HOME' } } }
    }
  };
  eq(
    'a surface outside tabs (the home browse) is blanked as before',
    JSON.parse(stripTrackingParams(JSON.stringify(home))).contents.tvBrowseRenderer.content
      .tvSurfaceContentRenderer.trackingParams,
    ''
  );
  // A kept surface whose value the pattern does not blank stays as sent, and the rest still goes.
  const odd = {
    continuationContents: {
      tvSurfaceContentContinuation: {
        trackingParams: 'has a " quote',
        inner: { trackingParams: 'GONE' }
      }
    }
  };
  const outOdd = JSON.parse(stripTrackingParams(JSON.stringify(odd)));
  eq(
    'a kept value with an escaped quote stays, its insides are still blanked',
    [
      outOdd.continuationContents.tvSurfaceContentContinuation.trackingParams,
      outOdd.continuationContents.tvSurfaceContentContinuation.inner.trackingParams
    ].join('|'),
    'has a " quote|'
  );
}

report.finish();
