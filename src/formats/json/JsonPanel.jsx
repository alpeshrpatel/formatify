import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import Toast from '../../components/Toast.jsx';
import ErrorPanel from './ErrorPanel.jsx';
import JsonConvertPanel from './JsonConvertPanel.jsx';
import JsonDiffPanel from './JsonDiffPanel.jsx';
import JsonEditor from './JsonEditor.jsx';
import JsonPathPanel from './JsonPathPanel.jsx';
import JsonSchemaPanel from './JsonSchemaPanel.jsx';
import JsonTree from './JsonTree.jsx';
import StatsBar from './StatsBar.jsx';
import Toolbar from './Toolbar.jsx';
import { beautifyJson, formatBytes, minifyJson, utf8Size } from './jsonFormatter.js';
import { validateJson } from './jsonParser.js';
import { repairJson } from './jsonRepair.js';
import { SAMPLES } from './samples.js';

const STORAGE_KEY = 'formatify:json:v1';

/** What a fresh visit starts with: a valid, empty JSON payload. */
const EMPTY_DOCUMENT = '{}';

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * The JSON workspace: editor + validation/tree output.
 * This used to be `App.jsx`; it is now a format panel so the Parquet and
 * Avro readers can live beside it.
 */
export default function JsonPanel({ notify: notifyProp, openRequest }) {
  const session = useMemo(readSession, []);

  const [text, setText] = useState(session.text ?? EMPTY_DOCUMENT);
  const [indent, setIndent] = useState(session.indent ?? '2');
  const [sortKeys, setSortKeys] = useState(session.sortKeys ?? false);
  const [tab, setTab] = useState(() =>
    validateJson(session.text ?? EMPTY_DOCUMENT).ok ? 'tree' : 'problems',
  );
  const [toast, setToast] = useState(null);
  const [fixNotes, setFixNotes] = useState([]);
  const [sourceLabel, setSourceLabel] = useState('untitled');
  // -1 so the first click on "Sample" loads SAMPLES[0] instead of skipping it.
  const [sampleIndex, setSampleIndex] = useState(-1);

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  const deferredText = useDeferredValue(text);
  const isChecking = deferredText !== text;
  const result = useMemo(() => validateJson(deferredText), [deferredText]);
  const error = result.ok ? null : result.error;
  const isEmpty = text.trim().length === 0;

  const notify = useCallback(
    (message, tone = 'info') => {
      if (notifyProp) {
        notifyProp(message, tone);
        return;
      }
      setToast({ message, tone, id: Date.now() });
    },
    [notifyProp],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, indent, sortKeys }));
    } catch {
      /* private browsing: skip persisting the session */
    }
  }, [text, indent, sortKeys]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const previousOk = useRef(null);
  useEffect(() => {
    if (previousOk.current === result.ok) return;
    const wasFirstRun = previousOk.current === null;
    previousOk.current = result.ok;
    // Only steer the user away from a utility tab when the parse state
    // actually broke; never yank them out of Diff / Convert / Schema.
    if (!result.ok) setTab('problems');
    else if (wasFirstRun || tab === 'problems') setTab('tree');
    // `tab` is intentionally excluded: this effect reacts to validity changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.ok]);

  const copyToClipboard = useCallback(
    async (value, label) => {
      try {
        await navigator.clipboard.writeText(value);
        notify(`${label} copied to the clipboard`, 'success');
      } catch {
        notify('The browser blocked clipboard access — copy it manually', 'error');
      }
    },
    [notify],
  );

  const goToError = useCallback(() => {
    if (error) editorRef.current?.selectIndex(error.index);
  }, [error]);

  const handleFormat = useCallback(() => {
    if (error) {
      notify(`Cannot format: ${error.message} (line ${error.line})`, 'error');
      goToError();
      return;
    }
    try {
      setText(beautifyJson(text, { indent, sortKeys }));
      setFixNotes([]);
      notify('Document formatted', 'success');
    } catch (formatError) {
      notify(formatError.message, 'error');
    }
  }, [error, goToError, indent, notify, sortKeys, text]);

  const handleMinify = useCallback(() => {
    if (error) {
      notify(`Cannot minify: ${error.message} (line ${error.line})`, 'error');
      goToError();
      return;
    }
    try {
      const minified = minifyJson(text, { sortKeys });
      const before = formatBytes(utf8Size(text));
      setText(minified);
      notify(`Minified to ${formatBytes(utf8Size(minified))} (was ${before})`, 'success');
    } catch (minifyError) {
      notify(minifyError.message, 'error');
    }
  }, [error, goToError, notify, sortKeys, text]);

  const handleSendToEditor = useCallback(
    (nextText, label) => {
      setText(nextText);
      setFixNotes([]);
      notify(`Loaded ${label} into the editor`, 'success');
    },
    [notify],
  );

  const handleAutoFix = useCallback(() => {
    const repaired = repairJson(text);
    if (!repaired.changed) {
      notify('Nothing to fix — the document is already valid JSON', 'info');
      return;
    }
    setText(repaired.text);
    setFixNotes(repaired.notes);
    if (repaired.result.ok) {
      const count = repaired.notes.length;
      notify(`Repaired the document (${count} change${count === 1 ? '' : 's'})`, 'success');
    } else {
      notify(`Partially repaired — ${repaired.result.error.message}`, 'error');
      editorRef.current?.selectIndex(repaired.result.error.index);
    }
  }, [notify, text]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = /\.json$/i.test(sourceLabel) ? sourceLabel : 'formatted.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    notify(`Downloaded ${anchor.download}`, 'success');
  }, [notify, sourceLabel, text]);

  const loadFile = useCallback(
    async (contents, name) => {
      setText(contents);
      setFixNotes([]);
      if (name) setSourceLabel(name);
      notify(name ? `Loaded ${name}` : 'Document loaded', 'info');
    },
    [notify],
  );

  const loadBytes = useCallback(
    async (bytes, name) => {
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        await loadFile(decoded, name);
        return true;
      } catch {
        notify(`${name ?? 'File'} is not decodable as UTF-8 text`, 'error');
        return false;
      }
    },
    [loadFile, notify],
  );

  const handlePickFile = useCallback(() => fileInputRef.current?.click(), []);

  // Files opened via the global "Open file" button route here through App.
  const openId = openRequest?.id;
  const openBytes = openRequest?.bytes;
  const openName = openRequest?.fileName;
  useEffect(() => {
    if (openBytes) loadBytes(openBytes, openName);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadSample = useCallback(() => {
    const next = (sampleIndex + 1) % SAMPLES.length;
    setSampleIndex(next);
    setText(SAMPLES[next].text);
    setFixNotes([]);
    setSourceLabel(SAMPLES[next].label);
    notify(`Loaded sample: ${SAMPLES[next].label}`, 'info');
  }, [notify, sampleIndex]);

  const handleClear = useCallback(() => {
    setText('');
    setFixNotes([]);
    setSourceLabel('untitled');
    notify('Editor cleared', 'info');
    editorRef.current?.focus();
  }, [notify]);

  const formatSummary = `${indent === 'tab' ? 'Tabs' : `${indent} spaces`}${
    sortKeys ? ' · keys sorted' : ''
  }`;

  const warningCount = result.warnings.length;
  const statusTone = !result.ok ? 'is-bad' : warningCount > 0 ? 'is-warn' : 'is-ok';
  const statusIcon = !result.ok ? 'alert' : warningCount > 0 ? 'info' : 'check';
  const statusLabel = isChecking
    ? 'Checking…'
    : !result.ok
      ? `Line ${error.line}, column ${error.column}`
      : warningCount > 0
        ? `Valid · ${warningCount} warning${warningCount === 1 ? '' : 's'}`
        : 'Valid JSON';

  return (
    <div className="format-panel" data-format-panel="json">
      <div className="format-status-row">
        <span className={`status-pill ${statusTone}`}>
          <Icon name={statusIcon} size={14} />
          {statusLabel}
        </span>
        <span className="panel-hint">Beautify, validate and repair JSON text.</span>
      </div>

      <Toolbar
        onFormat={handleFormat}
        onMinify={handleMinify}
        onAutoFix={handleAutoFix}
        onCopy={() => copyToClipboard(text, 'Document')}
        onDownload={handleDownload}
        onPickFile={handlePickFile}
        onSample={handleLoadSample}
        onClear={handleClear}
        indent={indent}
        onIndentChange={setIndent}
        sortKeys={sortKeys}
        onSortKeysChange={setSortKeys}
        hasError={Boolean(error)}
        isEmpty={isEmpty}
      />

      <main className="workspace">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="file" size={15} />
              Input
            </h2>
            <span className="panel-hint">{sourceLabel} · drop a file here to open it</span>
          </header>
          <JsonEditor
            ref={editorRef}
            value={text}
            onChange={setText}
            error={error}
            indent={indent}
            onFormat={handleFormat}
            onMinify={handleMinify}
            onAutoFix={handleAutoFix}
            onLoadFile={loadFile}
          />
          <StatsBar text={text} result={result} indent={indent} />
        </section>

        <section className="panel">
          <header className="panel-head">
            <div className="tabs" role="tablist" aria-label="JSON tools">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'problems'}
                className={tab === 'problems' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('problems')}
              >
                <span className={result.ok ? 'dot is-ok' : 'dot is-bad'} />
                {result.ok ? 'Validation' : 'Problem'}
                {result.ok && warningCount > 0 && (
                  <span className="tab-count">{warningCount}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'tree'}
                className={tab === 'tree' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('tree')}
              >
                <Icon name="braces" size={14} />
                Tree
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'jsonpath'}
                className={tab === 'jsonpath' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('jsonpath')}
                disabled={!result.ok}
                title="Query with JSONPath expressions"
              >
                <Icon name="search" size={14} />
                JSONPath
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'diff'}
                className={tab === 'diff' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('diff')}
                title="Compare against another JSON document"
              >
                <Icon name="diff" size={14} />
                Diff
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'convert'}
                className={tab === 'convert' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('convert')}
                disabled={!result.ok}
                title="Convert to and from YAML, XML and CSV"
              >
                <Icon name="convert" size={14} />
                Convert
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'schema'}
                className={tab === 'schema' ? 'tab is-active' : 'tab'}
                onClick={() => setTab('schema')}
                disabled={!result.ok}
                title="Validate against a JSON Schema, or infer one"
              >
                <Icon name="schema" size={14} />
                Schema
              </button>
            </div>
            <span className="panel-hint">{formatSummary}</span>
            <label className="select-wrap view-menu" title="Choose a JSON view">
              <span className="select-label">View</span>
              <select value={tab} onChange={(event) => setTab(event.target.value)}>
                <optgroup label="Document">
                  <option value="problems">Problems</option>
                  <option value="tree">Tree</option>
                </optgroup>
                <optgroup label="Query & compare">
                  <option value="jsonpath">JSONPath</option>
                  <option value="diff">Diff Viewer</option>
                  <option value="schema">Schema validation</option>
                </optgroup>
                <optgroup label="Convert">
                  <option value="convert">YAML / XML / CSV</option>
                </optgroup>
              </select>
            </label>
          </header>

          {fixNotes.length > 0 && (
            <div className="fix-report">
              <div className="fix-report-head">
                <Icon name="wand" />
                <strong>
                  Auto-fix applied {fixNotes.length} change{fixNotes.length === 1 ? '' : 's'}
                </strong>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => setFixNotes([])}
                  aria-label="Dismiss the auto-fix report"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <ul>
                {fixNotes.map((note) => (
                  <li key={`${note.line ?? 'x'}-${note.message}`}>{note.message}</li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'problems' ? (
            <ErrorPanel
              error={error}
              warnings={result.warnings}
              stats={result.stats}
              onJump={goToError}
              onAutoFix={handleAutoFix}
            />
          ) : !result.ok && tab !== 'diff' ? (
            <div className="panel-body">
              <p className="empty-hint">
                This view needs valid JSON. Fix the reported problem first — or try the Diff tab.
              </p>
            </div>
          ) : tab === 'jsonpath' ? (
            <JsonPathPanel data={result.value} />
          ) : tab === 'diff' ? (
            <JsonDiffPanel data={result.ok ? result.value : undefined} text={text} />
          ) : tab === 'convert' ? (
            <JsonConvertPanel
              data={result.value}
              onSendToEditor={handleSendToEditor}
              notify={notify}
            />
          ) : tab === 'schema' ? (
            <JsonSchemaPanel
              data={result.value}
              onSendToEditor={handleSendToEditor}
              notify={notify}
            />
          ) : (
            <JsonTree
              value={result.value}
              sortKeys={sortKeys}
              onCopyValue={(value, type) => copyToClipboard(value, `${type} value`)}
            />
          )}
        </section>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonl,.ndjson,.txt,application/json,text/plain"
        className="visually-hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const bytes = new Uint8Array(await file.arrayBuffer());
          await loadBytes(bytes, file.name);
          event.target.value = '';
        }}
      />

      {!notifyProp && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
