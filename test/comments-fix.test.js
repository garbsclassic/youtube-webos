import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitSelectorList, findCollapsingRules, buildOverrideCss } from '../src/comments-fix.js';

const rule = (selectorText, style = {}) => ({ selectorText, style });
const sheet = (...cssRules) => ({ cssRules });
const selectorsOf = rules => rules.map(r => r.selector);

describe('splitSelectorList', () => {
  test('splits on top-level commas, trims and drops empties', () => {
    assert.deepEqual(splitSelectorList('.a , .b,.c,, '), ['.a', '.b', '.c']);
  });

  test('returns a single selector unchanged', () => {
    assert.deepEqual(splitSelectorList('.a .frHKed > .b'), ['.a .frHKed > .b']);
  });

  test('keeps commas inside parentheses and attribute brackets', () => {
    assert.deepEqual(splitSelectorList(':is(.a, .b) .frHKed, .c'), [':is(.a, .b) .frHKed', '.c']);
    assert.deepEqual(splitSelectorList('[data-x="1,2"] .y,.z'), ['[data-x="1,2"] .y', '.z']);
  });

  test('returns an empty list for an empty string', () => {
    assert.deepEqual(splitSelectorList(''), []);
  });
});

describe('findCollapsingRules', () => {
  test('returns an empty list for no sheets', () => {
    assert.deepEqual(findCollapsingRules([]), []);
  });

  test('picks display:none rules on the closing classes with a display override', () => {
    const sheets = [
      sheet(
        rule('.app-quality-root .frHKed .AmQJbe', { display: 'none' }),
        rule('.xmQAdc', { display: 'none' })
      )
    ];
    assert.deepEqual(findCollapsingRules(sheets), [
      { selector: '.app-quality-root .frHKed .AmQJbe', overrides: ['display: block'] },
      { selector: '.xmQAdc', overrides: ['display: block'] }
    ]);
  });

  test('maps zero height, width and max-height in 0, 0px and 0rem forms to overrides', () => {
    const sheets = [
      sheet(
        rule('.frHKed .a', { height: '0' }),
        rule('.frHKed .b', { width: '0px' }),
        rule('.frHKed .c', { maxHeight: '0rem' })
      )
    ];
    assert.deepEqual(findCollapsingRules(sheets), [
      { selector: '.frHKed .a', overrides: ['height: auto'] },
      { selector: '.frHKed .b', overrides: ['width: auto'] },
      { selector: '.frHKed .c', overrides: ['max-height: none'] }
    ]);
  });

  test('lists overrides in display, height, width, max-height order', () => {
    const sheets = [
      sheet(rule('.frHKed .a', { maxHeight: '0', width: '0', height: '0', display: 'none' }))
    ];
    assert.deepEqual(findCollapsingRules(sheets), [
      {
        selector: '.frHKed .a',
        overrides: ['display: block', 'height: auto', 'width: auto', 'max-height: none']
      }
    ]);
  });

  test('overrides only what the rule collapses, so a display:none rule leaves width and height', () => {
    const sheets = [sheet(rule('.frHKed .AmQJbe', { display: 'none', width: '640px' }))];
    const [found] = findCollapsingRules(sheets);
    assert.deepEqual(found.overrides, ['display: block']);
  });

  test('ignores rules that only set opacity, visibility or transform', () => {
    const sheets = [
      sheet(
        rule('.frHKed .AmQJbe', { opacity: '0' }),
        rule('.frHKed .x', { visibility: 'hidden' }),
        rule('.xmQAdc .y', { transform: 'translateX(0)' })
      )
    ];
    assert.deepEqual(findCollapsingRules(sheets), []);
  });

  test('ignores non-zero sizes and display values other than none', () => {
    const sheets = [
      sheet(
        rule('.frHKed .a', { height: '10px' }),
        rule('.frHKed .b', { display: 'block' }),
        rule('.frHKed .c', { width: '0.5rem' }),
        rule('.frHKed .d', { maxHeight: '100%' })
      )
    ];
    assert.deepEqual(findCollapsingRules(sheets), []);
  });

  test('ignores collapsing rules on other classes', () => {
    const sheets = [sheet(rule('.other .AmQJbe', { display: 'none' }), rule('.ytLrSpinner', { height: '0' }))];
    assert.deepEqual(findCollapsingRules(sheets), []);
  });

  test('does not match class names that merely start with a closing class', () => {
    const sheets = [
      sheet(
        rule('.frHKedX', { height: '0' }),
        rule('.frHKed-foo .a', { display: 'none' }),
        rule('.xmQAdc_bar', { display: 'none' })
      )
    ];
    assert.deepEqual(findCollapsingRules(sheets), []);
  });

  test('matches a closing class followed by a pseudo-class, combinator or attribute', () => {
    const sheets = [
      sheet(
        rule('.frHKed:not(.x)', { display: 'none' }),
        rule('.frHKed>.a', { display: 'none' }),
        rule('.xmQAdc[hidden]', { display: 'none' })
      )
    ];
    assert.deepEqual(selectorsOf(findCollapsingRules(sheets)), [
      '.frHKed:not(.x)',
      '.frHKed>.a',
      '.xmQAdc[hidden]'
    ]);
  });

  test('keeps only the closing-class parts of a merged selector list', () => {
    const sheets = [
      sheet(rule('.a .frHKed .AmQJbe,.ytLrSpinner,.zylon-hidden, .xmQAdc .b', { display: 'none' }))
    ];
    assert.deepEqual(findCollapsingRules(sheets), [
      { selector: '.a .frHKed .AmQJbe', overrides: ['display: block'] },
      { selector: '.xmQAdc .b', overrides: ['display: block'] }
    ]);
  });

  test('does not split a comma inside :is() in front of a closing class', () => {
    const sheets = [sheet(rule(':is(.a, .b) .frHKed', { display: 'none' }))];
    assert.deepEqual(selectorsOf(findCollapsingRules(sheets)), [':is(.a, .b) .frHKed']);
  });

  test('recurses into grouping rules such as @media', () => {
    const sheets = [
      sheet({
        cssRules: [
          rule('.frHKed .a', { display: 'none' }),
          { cssRules: [rule('.xmQAdc .b', { height: '0' }), rule('.zzz', { display: 'none' })] }
        ]
      })
    ];
    assert.deepEqual(selectorsOf(findCollapsingRules(sheets)), ['.frHKed .a', '.xmQAdc .b']);
  });

  test('skips a sheet whose cssRules getter throws and still scans the others', () => {
    const crossOrigin = {
      get cssRules() {
        throw new Error('SecurityError');
      }
    };
    const sheets = [crossOrigin, sheet(rule('.frHKed .a', { display: 'none' }))];
    assert.deepEqual(selectorsOf(findCollapsingRules(sheets)), ['.frHKed .a']);
  });

  test('tolerates a sheet with no rules', () => {
    assert.deepEqual(findCollapsingRules([{ cssRules: null }, {}]), []);
  });
});

describe('buildOverrideCss', () => {
  test('writes one important override plus visibility:hidden per rule', () => {
    assert.equal(
      buildOverrideCss([{ selector: '.x .frHKed', overrides: ['display: block'] }]),
      '.x .frHKed { display: block !important; visibility: hidden !important; }'
    );
  });

  test('lists every override and joins rules with newlines', () => {
    const css = buildOverrideCss([
      { selector: '.a', overrides: ['height: auto', 'max-height: none'] },
      { selector: '.b', overrides: ['width: auto'] }
    ]);
    assert.equal(
      css,
      '.a { height: auto !important; max-height: none !important; visibility: hidden !important; }\n' +
        '.b { width: auto !important; visibility: hidden !important; }'
    );
  });

  test('returns an empty string for no rules', () => {
    assert.equal(buildOverrideCss([]), '');
  });
});
