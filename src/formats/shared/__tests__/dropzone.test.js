import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Must run before React is imported.
import '../../../../tools/dom-environment.mjs';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import avsc from 'avsc';
import { parquetWriteBuffer } from 'hyparquet-writer';

import App from '../../../App.jsx';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll with a fresh `act` per tick so React flushes queued work between checks. */
async function waitUntil(predicate, timeout = 3000) {
  const started = Date.now();
  while (!predicate() && Date.now() - started < timeout) {
    await act(async () => sleep(20));
  }
  assert.ok(predicate(), 'condition became true in time');
}

async function renderApp() {
  const container = document.createElement('div');
  document.body.append(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(App));
    await sleep(30); // let the lazy JSON panel resolve inside Suspense
  });
  return {
    container,
    text: () => container.textContent,
    findFormatTab: (label) =>
      [...container.querySelectorAll('.format-tab')].find((tab) => tab.textContent.includes(label)),
    click: async (element) => {
      await act(async () => {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(40); // lazy panel swap
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** A minimal `File` — the readers only need `name` + `arrayBuffer()`. */
function makeFile(name, bytes) {
  return new window.File([bytes], name);
}

/** Dispatch a synthetic drag event whose `dataTransfer` carries `files`. */
function fireDrag(target, type, files) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: { files, types: files.length > 0 ? ['Files'] : [] },
  });
  target.dispatchEvent(event);
  return event;
}

/* ----------------------- fixture files (real bytes) ----------------------- */

const SYNC_MARKER = new Array(16).fill(0x5a);

/** Avro `long`/`int`: zig-zag then 7-bit varint (small values only). */
function avroVarint(value) {
  let zigzag = BigInt(value) * 2n;
  const bytes = [];
  while (zigzag > 0x7fn) {
    bytes.push(Number(zigzag & 0x7fn) | 0x80);
    zigzag >>= 7n;
  }
  bytes.push(Number(zigzag));
  return bytes;
}

const ascii = (text) => [...text].map((ch) => ch.charCodeAt(0));

const USER_SCHEMA = {
  type: 'record',
  name: 'User',
  fields: [
    { name: 'id', type: 'int' },
    { name: 'name', type: 'string' },
  ],
};

/** A tiny valid Avro object container file (codec `null`). */
function buildAvroOcf(records) {
  const schemaJson = JSON.stringify(USER_SCHEMA);
  const type = avsc.Type.forSchema(USER_SCHEMA);
  const encoded = records.map((record) => new Uint8Array(type.toBuffer(record)));
  const payload = new Uint8Array(encoded.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of encoded) {
    payload.set(part, offset);
    offset += part.length;
  }

  const header = new Uint8Array([
    0x4f, 0x62, 0x6a, 0x01, // "Obj" + container version 1
    ...avroVarint(2), // two metadata pairs follow
    ...avroVarint('avro.schema'.length), ...ascii('avro.schema'),
    ...avroVarint(schemaJson.length), ...ascii(schemaJson),
    ...avroVarint('avro.codec'.length), ...ascii('avro.codec'),
    ...avroVarint('null'.length), ...ascii('null'),
    0x00, // end of map (zero-count block terminates the metadata map)
    ...SYNC_MARKER,
  ]);
  const block = new Uint8Array([
    ...avroVarint(records.length),
    ...avroVarint(payload.length),
    ...payload,
    ...SYNC_MARKER,
  ]);
  const ocf = new Uint8Array(header.length + block.length);
  ocf.set(header, 0);
  ocf.set(block, header.length);
  return ocf;
}

/** A small Parquet file written by the same writer the reader tests use. */
function buildParquet() {
  return new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'id', data: [1, 2, 3, 4] },
        { name: 'name', data: ['Ada', 'Bob', 'Cid', 'Dee'] },
        { name: 'score', data: [9.5, 7.25, 8.0, 6.5] },
        { name: 'active', data: [true, false, true, false] },
      ],
      codec: 'UNCOMPRESSED',
    }),
  );
}

/* --------------------------------- tests --------------------------------- */

describe('DropZone — dropping files inside the binary panels', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('Avro: a dropped container loads rows and shows no error', async () => {
    const app = await renderApp();
    await app.click(app.findFormatTab('Avro'));

    const zone = app.container.querySelector('.dropzone');
    assert.ok(zone, 'the Avro drop zone is rendered');

    const file = makeFile(
      'users.avro',
      buildAvroOcf([
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob' },
      ]),
    );

    let overEvent;
    await act(async () => {
      overEvent = fireDrag(zone, 'dragover', [file]);
      await sleep(10);
    });
    assert.equal(overEvent.defaultPrevented, true, 'the zone accepts the drag');
    assert.ok(zone.className.includes('is-dragging'), 'the zone highlights while dragging');

    let dropEvent;
    await act(async () => {
      dropEvent = fireDrag(zone, 'drop', [file]);
    });
    await waitUntil(() => app.text().includes('users.avro'));
    await act(async () => sleep(60));

    assert.equal(dropEvent.defaultPrevented, true, 'the zone claims the drop (page handler skips)');
    assert.match(app.text(), /users\.avro/);
    assert.match(app.text(), /codec: null/);
    assert.match(app.text(), /Ada/, 'preview rows decoded');
    assert.equal(app.container.querySelector('.error-card'), null, 'no read error');

    await app.unmount();
  });

  test('Parquet: a dropped file loads rows and shows no error', async () => {
    const app = await renderApp();
    await app.click(app.findFormatTab('Parquet'));

    const zone = app.container.querySelector('.dropzone');
    assert.ok(zone, 'the Parquet drop zone is rendered');

    const file = makeFile('people.parquet', buildParquet());

    let dropEvent;
    await act(async () => {
      fireDrag(zone, 'dragover', [file]);
      dropEvent = fireDrag(zone, 'drop', [file]);
    });
    await waitUntil(() => app.text().includes('people.parquet'));
    await act(async () => sleep(60));

    assert.equal(dropEvent.defaultPrevented, true, 'the zone claims the drop (page handler skips)');
    assert.match(app.text(), /people\.parquet/);
    assert.match(app.text(), /4 rows/);
    assert.match(app.text(), /Ada/, 'preview rows decoded');
    assert.equal(app.container.querySelector('.error-card'), null, 'no read error');

    await app.unmount();
  });
});

describe('App — dropping a file anywhere on the page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('a .parquet drop outside any zone routes to the Parquet reader', async () => {
    const app = await renderApp(); // JSON tab is active by default
    const file = makeFile('people.parquet', buildParquet());

    await act(async () => {
      fireDrag(document.body, 'dragover', [file]);
      await sleep(10);
    });
    assert.ok(app.container.querySelector('.drop-overlay'), 'the page overlay shows while dragging');

    let dropEvent;
    await act(async () => {
      dropEvent = fireDrag(document.body, 'drop', [file]);
    });
    assert.equal(dropEvent.defaultPrevented, true, 'the browser is told not to open the file');
    await waitUntil(() => app.findFormatTab('Parquet').className.includes('is-active'));
    await waitUntil(() => app.text().includes('people.parquet'));
    await waitUntil(() => app.text().includes('Ada'));
    await act(async () => sleep(60));

    assert.equal(app.container.querySelector('.drop-overlay'), null, 'the overlay clears after drop');
    assert.equal(app.container.querySelector('.error-card'), null, 'no read error');

    await app.unmount();
  });

  test('an .avro drop outside any zone routes to the Avro reader', async () => {
    const app = await renderApp();
    const file = makeFile(
      'users.avro',
      buildAvroOcf([
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob' },
      ]),
    );

    await act(async () => {
      fireDrag(document.body, 'drop', [file]);
    });
    await waitUntil(() => app.findFormatTab('Avro').className.includes('is-active'));
    await waitUntil(() => app.text().includes('users.avro'));
    await waitUntil(() => app.text().includes('Bob'));
    await act(async () => sleep(60));

    assert.equal(app.container.querySelector('.error-card'), null, 'no read error');

    await app.unmount();
  });
});
