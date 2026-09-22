import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Must run before React is imported.
import '../../../tools/dom-environment.mjs';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import App from '../../App.jsx';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderApp() {
  const container = document.createElement('div');
  document.body.append(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(App));
    await sleep(30);
  });
  return {
    container,
    findFormatTab: (label) =>
      [...container.querySelectorAll('.format-tab')].find((tab) => tab.textContent.includes(label)),
    press: async (init) => {
      await act(async () => {
        window.dispatchEvent(
          new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
        );
        await sleep(30);
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('App — header shortcuts & deep links', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', window.location.pathname);
    document.documentElement.dataset.theme = 'dark';
  });

  test('Ctrl/⌘ + 2 switches to the Parquet workspace', async () => {
    const app = await renderApp();
    assert.ok(app.findFormatTab('JSON').className.includes('is-active'));

    await app.press({ key: '2', ctrlKey: true });
    assert.ok(app.findFormatTab('Parquet').className.includes('is-active'), 'Ctrl+2 → Parquet');

    await app.press({ key: '1', metaKey: true });
    assert.ok(app.findFormatTab('JSON').className.includes('is-active'), '⌘+1 → JSON');

    await app.unmount();
  });

  test('the active tab is reflected in the URL and document title', async () => {
    const app = await renderApp();
    assert.equal(window.location.hash, '#json');
    assert.equal(document.title, 'JSON · Formatify');

    await app.press({ key: '3', ctrlKey: true });
    assert.equal(window.location.hash, '#avro');
    assert.equal(document.title, 'Avro · Formatify');

    await app.unmount();
  });

  test('a #parquet deep link opens that workspace on load', async () => {
    window.history.replaceState(null, '', '#parquet');
    const app = await renderApp();

    assert.ok(app.findFormatTab('Parquet').className.includes('is-active'));
    assert.ok(app.container.querySelector('.dropzone'), 'the Parquet reader is mounted');

    await app.unmount();
  });

  test('? opens the shortcut guide and Escape closes it', async () => {
    const app = await renderApp();
    assert.equal(app.container.querySelector('.shortcuts-card'), null);

    await app.press({ key: '?' });
    const card = app.container.querySelector('.shortcuts-card');
    assert.ok(card, 'the guide opens on ?');
    assert.match(card.textContent, /Switch to the JSON workspace/);

    await app.press({ key: 'Escape' });
    assert.equal(app.container.querySelector('.shortcuts-card'), null, 'Escape closes the guide');

    await app.unmount();
  });

  test('Ctrl/⌘ + ⇧ + L toggles the colour theme', async () => {
    const app = await renderApp();
    assert.equal(document.documentElement.dataset.theme, 'dark');

    await app.press({ key: 'L', ctrlKey: true, shiftKey: true });
    assert.equal(document.documentElement.dataset.theme, 'light');

    await app.press({ key: 'L', metaKey: true, shiftKey: true });
    assert.equal(document.documentElement.dataset.theme, 'dark');

    await app.unmount();
  });
});