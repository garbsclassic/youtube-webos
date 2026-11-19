/**
 * The comments-panel fix as a unit: splitting a selector list on its top-level commas only, the
 * scan of the stylesheets keeping just the closing-class parts of a minified rule with only the
 * declarations that undo what the rule collapses, and the override text built from them.
 *
 * Run: node tests/unit/comments-fix-test.cjs
 */
'use strict';

const path = require('path');
const { createReport } = require('../harness/report.cjs');
const { SRC, CORE, loggerStub } = require('../harness/stubs.cjs');
const { loadSources } = require('../harness/sandbox.cjs');

const report = createReport();
const t = report.check;
const eq = report.eq;

// The module scans at load and adds a focus listener: a document with no stylesheets yet, which
// each case below fills in, and timers that never fire so the startup rescan stays out of it.
const head = { children: [], appendChild: (el) => (head.children.push(el), el) };
const document = {
  styleSheets: [],
  adoptedStyleSheets: [],
  head,
  documentElement: head,
  createElement: () => ({ id: '', textContent: '' }),
  addEventListener() {},
  removeEventListener() {}
};
const { sandbox } = loadSources(
  [CORE('selectors.js'), path.join(SRC, 'features', 'comments-fix.js')],
  { document, setTimeout: () => 0, createLogger: loggerStub().createLogger }
);
const { splitSelectorList, buildOverrideCss, findCollapsingRules } = sandbox;

/** A style rule the way the CSSOM gives it: its selector text and the properties it sets. */
const rule = (selectorText, style) => ({ selectorText, style });
/** A stylesheet holding `rules`. */
const sheet = (...rules) => ({ cssRules: rules });
/** The scan over these stylesheets, as plain data. */
const scan = (sheets, adopted) => {
  document.styleSheets = sheets;
  document.adoptedStyleSheets = adopted || [];
  return JSON.parse(JSON.stringify(findCollapsingRules()));
};

// ---- splitSelectorList ----
{
  eq('a single selector is one part', JSON.stringify(splitSelectorList('.a .b')), '[".a .b"]');
  eq(
    'top-level commas split, with the parts trimmed',
    JSON.stringify(splitSelectorList('.zylon-hidden,  ytlr-animated-overlay.frHKed .AmQJbe ')),
    '[".zylon-hidden","ytlr-animated-overlay.frHKed .AmQJbe"]'
  );
  eq(
    'commas inside :is() and [attr] are not split points',
    JSON.stringify(splitSelectorList('.frHKed :is(.a, .b) .c,[data-x="1,2"] .d')),
    '[".frHKed :is(.a, .b) .c","[data-x=\\"1,2\\"] .d"]'
  );
  eq(
    'nested parentheses keep their commas too',
    JSON.stringify(splitSelectorList(':is(.a, :not(.b, .c)), .frHKed')),
    '[":is(.a, :not(.b, .c))",".frHKed"]'
  );
  eq('empty parts are dropped', JSON.stringify(splitSelectorList('.a,,.b,')), '[".a",".b"]');
}

// ---- findCollapsingRules: a minified rule list ----
{
  const found = scan([
    sheet(rule('.zylon-hidden, ytlr-animated-overlay.frHKed .AmQJbe', { display: 'none' }))
  ]);
  eq('a merged rule gives one override', found.length, 1);
  eq(
    'only the part naming the closing class is kept, never .zylon-hidden',
    found[0] && found[0].selector,
    'ytlr-animated-overlay.frHKed .AmQJbe'
  );
  eq(
    'a rule that collapses only display gets display: block and nothing else',
    found[0] && found[0].overrides.join(' | '),
    'display: block'
  );
}

// ---- findCollapsingRules: each collapsed property, and only those ----
{
  const found = scan([
    sheet(
      rule('.frHKed .RowList', { height: '0px', width: '0', maxHeight: '0rem', color: 'red' }),
      rule('.xmQAdc .All', { display: 'none', height: '0', width: '0px', maxHeight: '0' }),
      rule('.frHKed .Sized', { height: '10px', width: 'auto', maxHeight: '5px' })
    )
  ]);
  eq('two rules collapse something, the sized one does not', found.length, 2);
  eq(
    'zero height, width and max-height are each undone',
    found[0] && found[0].overrides.join(' | '),
    'height: auto | width: auto | max-height: none'
  );
  eq(
    'the second closing class counts, with all four overrides',
    found[1] && found[1].selector + ' / ' + found[1].overrides.join(' | '),
    '.xmQAdc .All / display: block | height: auto | width: auto | max-height: none'
  );
}

// ---- findCollapsingRules: :is() lists, @media, adopted and unreadable sheets ----
{
  const found = scan(
    [
      sheet(rule('.other, .frHKed :is(.a, .b) .c', { height: '0' })),
      {
        get cssRules() {
          throw new Error('SecurityError: cross-origin');
        }
      },
      sheet({ cssRules: [rule('.frHKed .InMedia', { display: 'none' })] })
    ],
    [sheet(rule('.frHKed .Adopted', { width: '0px' }))]
  );
  eq(
    'a closing-class selector with commas inside :is() is kept whole',
    found[0] && found[0].selector,
    '.frHKed :is(.a, .b) .c'
  );
  eq('a cross-origin sheet is skipped and the scan goes on', found.length, 3);
  eq('a rule inside @media is found', found[1] && found[1].selector, '.frHKed .InMedia');
  eq(
    'a rule in an adopted stylesheet is found',
    found[2] && found[2].selector + ' / ' + found[2].overrides.join(' | '),
    '.frHKed .Adopted / width: auto'
  );
}

// ---- findCollapsingRules: nothing to override ----
{
  eq(
    'a collapsing rule without a closing class gives nothing',
    scan([sheet(rule('.zylon-hidden, .AmQJbe', { display: 'none', height: '0' }))]).length,
    0
  );
  eq(
    'a closing-class rule that collapses nothing gives nothing',
    scan([sheet(rule('.frHKed .Keep', { color: 'red', height: '1px', display: 'flex' }))]).length,
    0
  );
  eq('no stylesheets give nothing', scan([]).length, 0);
}

// ---- buildOverrideCss ----
{
  const css = buildOverrideCss([
    { selector: 'ytlr-animated-overlay.frHKed .AmQJbe', overrides: ['display: block'] },
    { selector: '.frHKed .RowList', overrides: ['height: auto', 'max-height: none'] }
  ]);
  eq(
    'one line per rule: its overrides, then visibility hidden, all !important',
    css,
    'ytlr-animated-overlay.frHKed .AmQJbe { display: block !important; visibility: hidden !important; }\n' +
      '.frHKed .RowList { height: auto !important; max-height: none !important; visibility: hidden !important; }'
  );
  t('a display-only rule gets no width: auto', css.split('\n')[0].indexOf('width') === -1);
  eq('no rules give an empty stylesheet', buildOverrideCss([]), '');
}

report.finish();
