// A titled group of rows. Sizing and spacing live in pages.css so the whole
// panel can be retuned in one place.
import { createElement } from '../../dom.js';

/** A titled group of rows. */
export function createSection(title, elements) {
  const heading = createElement('div', { text: title, class: 'ytaf-section-title' });
  return createElement('div', { class: 'ytaf-settings-section' }, heading, ...elements);
}
