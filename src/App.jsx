import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

import Icon from './components/Icon.jsx';
import Toast from './components/Toast.jsx';
import { FORMATS, detectFormat, getFormat } from './formats/index.js';

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
        bytes = new Uint8Array(await file.arrayBuffer());
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}


