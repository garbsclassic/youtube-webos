import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findCollapsingSelectors } from '../src/comments-fix.js';

const rule = (selectorText, style = {}) => ({ selectorText, style });
const sheet = (...cssRules) => ({ cssRules });

describe('findCollapsingSelectors', () => {
  test('returns an empty list for no sheets', () => {
    assert.deepEqual(findCollapsingSelectors([]), []);
  });

  test('picks display:none rules on the closing classes', () => {
    const sheets = [
      sheet(
        rule('.app-quality-root .frHKed .AmQJbe', { display: 'none' }),
        rule('.xmQAdc', { display: 'none' })
      )
    ];
    assert.deepEqual(findCollapsingSelectors(sheets), [
      '.app-quality-root .frHKed .AmQJbe',
      '.xmQAdc'
    ]);
  });

  test('picks zero height, width and max-height in 0, 0px and 0rem forms', () => {
    const sheets = [
      sheet(
        rule('.frHKed .a', { height: '0' }),
        rule('.frHKed .b', { width: '0px' }),
        rule('.frHKed .c', { maxHeight: '0rem' }),
        rule('.frHKed .d', { height: '0px' })
      )
    ];
    assert.deepEqual(findCollapsingSelectors(sheets), [
      '.frHKed .a',
      '.frHKed .b',
      '.frHKed .c',
      '.frHKed .d'
    ]);
  });

  test('ignores rules that only set opacity, visibility or transform', () => {
    const sheets = [
      sheet(
        rule('.frHKed .AmQJbe', { opacity: '0' }),
        rule('.frHKed .x', { visibility: 'hidden' }),
        rule('.xmQAdc .y', { transform: 'translateX(0)' })
      )
    ];
    assert.deepEqual(findCollapsingSelectors(sheets), []);
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
    assert.deepEqual(findCollapsingSelectors(sheets), []);
  });

  test('ignores collapsing rules on other classes', () => {
    const sheets = [
      sheet(rule('.other .AmQJbe', { display: 'none' }), rule('.frHKedX', { height: '0' }))
    ];
    // `.frHKedX` still contains the substring `.frHKed`; only unrelated classes are excluded.
    assert.deepEqual(findCollapsingSelectors(sheets), ['.frHKedX']);
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
    assert.deepEqual(findCollapsingSelectors(sheets), ['.frHKed .a', '.xmQAdc .b']);
  });

  test('skips a sheet whose cssRules getter throws and still scans the others', () => {
    const crossOrigin = {
      get cssRules() {
        throw new Error('SecurityError');
      }
    };
    const sheets = [crossOrigin, sheet(rule('.frHKed .a', { display: 'none' }))];
    assert.deepEqual(findCollapsingSelectors(sheets), ['.frHKed .a']);
  });

  test('tolerates a sheet with no rules', () => {
    assert.deepEqual(findCollapsingSelectors([{ cssRules: null }, {}]), []);
  });
});
