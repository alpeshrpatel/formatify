/**
 * jsdom test environment for the React integration tests.
 *
 * Imported first (before React) so that `window`, `document` and
 * `localStorage` exist by the time the modules are evaluated.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const { window } = dom;

const expose = (name, value) =>
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

window.global = window;

expose('window', window);
expose('document', window.document);
expose('navigator', window.navigator);
expose('location', window.location);
expose('HTMLElement', window.HTMLElement);
expose('HTMLTextAreaElement', window.HTMLTextAreaElement);
expose('HTMLInputElement', window.HTMLInputElement);
expose('Element', window.Element);
expose('Node', window.Node);
expose('Event', window.Event);
expose('CustomEvent', window.CustomEvent);
expose('MouseEvent', window.MouseEvent);
expose('KeyboardEvent', window.KeyboardEvent);
expose('getComputedStyle', window.getComputedStyle.bind(window));
expose('DOMParser', window.DOMParser);
expose('XMLSerializer', window.XMLSerializer);
expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
expose('IS_REACT_ACT_ENVIRONMENT', true);

// jsdom has no clipboard: record what the app tries to copy instead.
const clipboard = { text: '' };
Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async (value) => {
      clipboard.text = value;
    },
  },
});
Object.defineProperty(window, 'clipboardText', { configurable: true, get: () => clipboard.text });

window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};

export { dom, window };
