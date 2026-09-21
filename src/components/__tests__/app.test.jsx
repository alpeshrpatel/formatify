import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Must run before React is imported.
import '../../../tools/dom-environment.mjs';

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import App from '../../App.jsx';
import { detectFormat } from '../../formats/index.js';

/** Types text into a controlled React textarea the way a user would. */
function typeInto(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  ).set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function clickOn(element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderApp() {
  const container = document.createElement('div');
  document.body.append(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
    await sleep(30); // let lazy panels resolve inside Suspense
  });
  return {
    container,
    textarea: () => container.querySelector('textarea'),
    text: () => container.textContent,
    findButton: (label) =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent.trim().toLowerCase().startsWith(label.toLowerCase()),
      ),
    findFormatTab: (label) =>
      [...container.querySelectorAll('.format-tab')].find((tab) =>
        tab.textContent.includes(label),
      ),
    click: async (element) => {
      await act(async () => {
        clickOn(element);
        await sleep(20);
      });
    },
    type: async (value) => {
      await act(async () => typeInto(container.querySelector('textarea'), value));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('App — format switching', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
  });

  test('renders the three format tabs with JSON active by default', async () => {
    const app = await renderApp();

    const tabs = [...app.container.querySelectorAll('.format-tab')];
    assert.deepEqual(
      tabs.map((tab) => tab.textContent.trim()),
      ['JSON', 'Parquet', 'Avro'],
    );
    assert.ok(app.findFormatTab('JSON').className.includes('is-active'));
    assert.ok(app.textarea(), 'the JSON editor is mounted by default');

    await app.unmount();
  });

  test('switching to Parquet shows the binary reader drop zone', async () => {
    const app = await renderApp();

    await app.click(app.findFormatTab('Parquet'));

    assert.ok(app.findFormatTab('Parquet').className.includes('is-active'));
    assert.ok(app.container.querySelector('.dropzone'), 'the drop zone is rendered');
    assert.ok(!app.textarea(), 'the JSON editor is gone');

    await app.unmount();
  });

  test('switching to Avro shows its reader and switching back restores JSON', async () => {
    const app = await renderApp();
    await app.type('{"kept": true}');

    await app.click(app.findFormatTab('Avro'));
    assert.ok(app.container.querySelector('.dropzone'));

    await app.click(app.findFormatTab('JSON'));
    assert.equal(app.textarea().value, '{"kept": true}', 'the JSON draft survives tab switches');

    await app.unmount();
  });

  test('the theme toggle still works in the shell', async () => {
    const app = await renderApp();
    const toggle = app.container.querySelector('[aria-label="Toggle colour theme"]');

    await app.click(toggle);
    assert.equal(document.documentElement.dataset.theme, 'light');
    await app.click(toggle);
    assert.equal(document.documentElement.dataset.theme, 'dark');

    await app.unmount();
  });
});

describe('App — file routing', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('detectFormat routes JSON, Parquet and Avro by magic bytes', () => {
    const jsonBytes = new TextEncoder().encode('{"hello": "world"}');
    const parquetBytes = new TextEncoder().encode('PAR1....PAR1');
    const avroBytes = new Uint8Array([0x4f, 0x62, 0x6a, 0x01, 1, 2, 3]);

    assert.equal(detectFormat({ name: '', bytes: jsonBytes }), 'json');
    assert.equal(detectFormat({ name: '', bytes: parquetBytes }), 'parquet');
    assert.equal(detectFormat({ name: '', bytes: avroBytes }), 'avro');
    // Extension wins over content.
    assert.equal(detectFormat({ name: 'data.json', bytes: parquetBytes }), 'json');
    assert.equal(detectFormat({ name: 'data.parquet', bytes: jsonBytes }), 'parquet');
  });

  test('the JSON workspace still reports exact line and column errors', async () => {
    const app = await renderApp();
    await app.type('{\n  "a": 1,\n}\n');

    const rendered = app.text();
    assert.match(rendered, /Invalid JSON/);
    assert.match(rendered, /Line 3, column 1/);
    assert.match(rendered, /Trailing comma before "}" is not allowed/);
    assert.ok(app.container.querySelector('.editor-line-number.is-error'));
    assert.ok(app.container.querySelector('.editor-error-caret'));

    await app.unmount();
  });

  test('auto-fix still repairs the document from the shell', async () => {
    const app = await renderApp();
    await app.type('{ name: ‘Ada’, active: True, }');

    await app.click(app.findButton('Auto-fix'));

    const fixed = app.textarea().value;
    assert.deepEqual(JSON.parse(fixed), { name: 'Ada', active: true });
    assert.match(app.text(), /Repaired the document/);

    await app.unmount();
  });
});
