/** Ad-hoc debug: trace the drop pipeline in jsdom. */
import { window } from './tools/dom-environment.mjs';
const document = window.document;

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App.jsx';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Instrument the File read path.
const origAb = window.File.prototype.arrayBuffer;
window.File.prototype.arrayBuffer = function (...args) {
  console.log('  [file] arrayBuffer() called on', this.name, 'size', this.size);
  return origAb.apply(this, args).then(
    (buf) => {
      console.log('  [file] arrayBuffer resolved', buf.byteLength);
      return buf;
    },
    (err) => {
      console.log('  [file] arrayBuffer REJECTED', err && err.message);
      throw err;
    },
  );
};

function fireDrag(target, type, files) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: { files, types: files.length > 0 ? ['Files'] : [] },
  });
  target.dispatchEvent(event);
  return event;
}

const fakeBytes = new Uint8Array([0x4f, 0x62, 0x6a, 0x01, 1, 2, 3, 4]);

async function main() {
  window.localStorage.clear();
  const container = document.createElement('div');
  document.body.append(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(App));
    await sleep(30);
  });

  // switch to Avro tab
  const avroTab = [...container.querySelectorAll('.format-tab')].find((t) =>
    t.textContent.includes('Avro'),
  );
  await act(async () => {
    avroTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(40);
  });
  const zone = container.querySelector('.dropzone');
  console.log('zone found:', Boolean(zone));

  // ---- zone drop ----
  const f1 = new window.File([fakeBytes], 'users.avro');
  console.log('zone dragover:');
  const over = fireDrag(zone, 'dragover', [f1]);
  await act(async () => sleep(20));
  console.log('  over.defaultPrevented =', over.defaultPrevented, '| zone class =', zone.className);

  console.log('zone drop:');
  const drop = fireDrag(zone, 'drop', [f1]);
  console.log('  drop.defaultPrevented (sync) =', drop.defaultPrevented);
  await act(async () => sleep(300));
  const toast = container.querySelector('.toast');
  console.log('  toast:', toast ? toast.textContent : '(none)');
  console.log('  text has users.avro:', container.textContent.includes('users.avro'));
  console.log('  error card:', Boolean(container.querySelector('.error-card')));

  await act(async () => root.unmount());
  container.remove();

  // ---- body drop (fresh app) ----
  window.localStorage.clear();
  const container2 = document.createElement('div');
  document.body.append(container2);
  await act(async () => {
    root = createRoot(container2);
    root.render(createElement(App));
    await sleep(30);
  });
  console.log('body drop:');
  const f2 = new window.File([fakeBytes], 'users.avro');
  const drop2 = fireDrag(document.body, 'drop', [f2]);
  console.log('  drop.defaultPrevented (sync) =', drop2.defaultPrevented);
  await act(async () => sleep(500));
  const tabs = [...container2.querySelectorAll('.format-tab')].map(
    (t) => `${t.textContent.trim()}[${t.className}]`,
  );
  console.log('  tabs:', tabs.join(' '));
  const toast2 = container2.querySelector('.toast');
  console.log('  toast:', toast2 ? toast2.textContent : '(none)');
  console.log('  text has users.avro:', container2.textContent.includes('users.avro'));

  await act(async () => root.unmount());
  container2.remove();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('DEBUG SCRIPT ERROR:', err);
    process.exit(1);
  },
);
