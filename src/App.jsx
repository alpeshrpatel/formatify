import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

import Icon from './components/Icon.jsx';
import Toast from './components/Toast.jsx';
import { FORMATS, detectFormat, getFormat } from './formats/index.js';
import { readFileBytes } from './formats/shared/binaryUtils.js';

/** One lazy panel per format id, created on first use and cached. */
const PANEL_CACHE = new Map();
function getPanel(format) {
  if (!PANEL_CACHE.has(format.id)) {
    PANEL_CACHE.set(format.id, lazy(format.loadPanel));
  }
  return PANEL_CACHE.get(format.id);
}

const STORAGE_KEY = 'formatify:session:v2';

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * App shell: brand topbar, format switcher, global file opener, theme.
 * Each format owns its workspace under `src/formats/<id>/` and is
 * code-split — the JSON bundle stays lean until Parquet/Avro are opened.
 */
export default function App() {
  const [session] = useState(readSession);
  const [formatId, setFormatId] = useState(() =>
    FORMATS.some((entry) => entry.id === session.formatId) ? session.formatId : 'json',
  );
  const [theme, setTheme] = useState(session.theme ?? 'dark');
  const [toast, setToast] = useState(null);
  const [incomingFile, setIncomingFile] = useState(null);
  const [pageDragging, setPageDragging] = useState(false);

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ formatId, theme }));
    } catch {
      /* private browsing: skip persisting the session */
    }
  }, [formatId, theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const switchFormat = useCallback((id) => setFormatId(getFormat(id).id), []);

  const openFile = useCallback(
    async (file) => {
      if (!file) return;
      let bytes;
      try {
        bytes = await readFileBytes(file); // arrayBuffer, with a FileReader fallback
      } catch {
        notify(`Could not read ${file.name}`, 'error');
        return;
      }
      const detected = detectFormat({ name: file.name, bytes });
      setFormatId(detected);
      setIncomingFile({ fileName: file.name, bytes, id: Date.now() });
      notify(`Loaded ${file.name} → ${getFormat(detected).label}`, 'info');
    },
    [notify],
  );

  // Drop anywhere on the page: route the file through the same opener as the
  // topbar button. Inner drop targets (DropZone, the JSON editor) call
  // preventDefault first and keep priority; the overlay is feedback only.
  useEffect(() => {
    const hasFiles = (event) =>
      Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types ?? []).includes('Files');
    const handleDragOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); // without this the browser never fires `drop`
      setPageDragging(true);
    };
    const handleDrop = (event) => {
      if (!hasFiles(event)) return;
      setPageDragging(false);
      if (event.defaultPrevented) return; // an inner drop target already claimed it
      event.preventDefault(); // stop the browser navigating to the file itself
      const file = event.dataTransfer.files?.[0];
      if (file) openFile(file);
    };
    const handleDragEnd = (event) => {
      // `dragleave` fires for child hops too; only treat it as "left the window".
      if (event.type === 'dragleave' && event.relatedTarget) return;
      setPageDragging(false);
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragleave', handleDragEnd);
    document.addEventListener('dragend', handleDragEnd);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragleave', handleDragEnd);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [openFile]);

  const format = getFormat(formatId);
  const Panel = getPanel(format);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="braces" size={18} />
          </span>
          <div className="brand-text">
            <h1>Formatify</h1>
            <p>
              Beautify and validate JSON — or drop in Parquet and Avro files to inspect their
              schemas and rows.
            </p>
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="btn"
            onClick={() => document.getElementById('formatify-global-file')?.click()}
            title="Open any supported file — it routes to the right reader"
          >
            <Icon name="upload" />
            <span>Open file</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle colour theme"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <nav className="format-switcher" aria-label="Formats">
        {FORMATS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === format.id ? 'format-tab is-active' : 'format-tab'}
            aria-pressed={entry.id === format.id}
            onClick={() => switchFormat(entry.id)}
            title={entry.description}
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
          </button>
        ))}
        <span className="format-switcher-hint">{format.description}</span>
      </nav>

      <Suspense fallback={<p className="empty-hint">Loading the {format.label} workspace…</p>}>
        <Panel notify={notify} openRequest={incomingFile} />
      </Suspense>

      <input
        id="formatify-global-file"
        type="file"
        accept=".json,.jsonl,.ndjson,.txt,.parquet,.pq,.pqt,.avro,application/json,application/octet-stream,text/plain"
        className="visually-hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await openFile(file);
          event.target.value = '';
        }}
      />

      {pageDragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <Icon name="upload" size={18} />
            <span>Drop to open — we&apos;ll route it to the right reader</span>
          </div>
        </div>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}


