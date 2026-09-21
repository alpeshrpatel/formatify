import { useCallback, useEffect, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import Toast from '../../components/Toast.jsx';
import { downloadFile, readFileBytes, toJsonSafe } from '../shared/binaryUtils.js';
import DropZone from '../shared/DropZone.jsx';
import { FileMetaChips, RowCountLabel } from '../shared/RecordsMeta.jsx';
import RecordsTable from '../shared/RecordsTable.jsx';
import SchemaView, { CollapsedList } from '../shared/SchemaView.jsx';
import { readParquetMetadata, readParquetPreview } from './parquetReader.js';

export const PREVIEW_LIMIT = 500;

const CODEC_LABELS = {
  0: 'UNCOMPRESSED',
  1: 'SNAPPY',
  2: 'GZIP',
  3: 'LZO',
  4: 'BROTLI',
  5: 'LZ4',
  6: 'ZSTD',
  7: 'LZ4_RAW',
};

/** Friendly label for hyparquet's numeric (or string) codec ids. */
export function codecLabel(codec) {
  const key = String(codec).toUpperCase();
  if (CODEC_LABELS[key] !== undefined) return CODEC_LABELS[key];
  if (/^[A-Z0-9_]+$/.test(key)) return key;
  return String(codec);
}

/**
 * The Parquet workspace: footer metadata + schema tree + paged row preview.
 * Large files never fully decode — the footer loads first, then the first
 * PREVIEW_LIMIT rows stream in. A column projection keeps wide files fast.
 */
export default function ParquetPanel({ notify: notifyProp, openRequest }) {
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState(null);
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [tab, setTab] = useState('rows');
  const [toast, setToast] = useState(null);
  const [columns, setColumns] = useState(null);

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
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadBytes = useCallback(
    async (nextBytes, name) => {
      setFileName(name ?? 'dropped.parquet');
      setBytes(nextBytes);
      setMeta(null);
      setRows([]);
      setColumns(null);
      setLoadError(null);
      setTab('rows');
      setLoading(true);
      try {
        const metadata = await readParquetMetadata(nextBytes);
        setMeta(metadata);
        setLoadingRows(true);
        try {
          const preview = await readParquetPreview(nextBytes, {
            rowStart: 0,
            rowEnd: Math.min(PREVIEW_LIMIT, Number(metadata.totalRows) || PREVIEW_LIMIT),
          });
          setRows(preview);
        } finally {
          setLoadingRows(false);
        }
        notify(`Loaded ${name ?? 'file'} — ${Number(metadata.totalRows).toLocaleString()} rows`, 'success');
      } catch (cause) {
        setLoadError(cause);
        notify(cause.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  const onFile = useCallback(
    async (file) => {
      try {
        await loadBytes(await readFileBytes(file), file.name);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
        notify('Could not read that file', 'error');
      }
    },
    [loadBytes, notify],
  );

  // Files dropped on the global "Open file" button route here via App.
  const openId = openRequest?.id;
  const openBytes = openRequest?.bytes;
  const openName = openRequest?.fileName;
  useEffect(() => {
    if (openBytes) loadBytes(openBytes, openName);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleColumn = useCallback(
    (name) => {
      setColumns((prev) => {
        const all = meta?.columns?.map((c) => c.name) ?? [];
        const current = prev ?? all;
        if (current.includes(name)) {
          const next = current.filter((c) => c !== name);
          return next.length === 0 ? current : next;
        }
        return [...current, name];
      });
    },
    [meta],
  );

  const reloadPreview = useCallback(async () => {
    if (!bytes || !meta) return;
    setLoadingRows(true);
    try {
      const preview = await readParquetPreview(bytes, {
        rowStart: 0,
        rowEnd: Math.min(PREVIEW_LIMIT, Number(meta.totalRows) || PREVIEW_LIMIT),
        columns: columns ?? undefined,
      });
      setRows(preview);
      notify('Preview reloaded', 'success');
    } catch (cause) {
      notify(cause.message, 'error');
    } finally {
      setLoadingRows(false);
    }
  }, [bytes, meta, columns, notify]);

  const exportJson = useCallback(() => {
    if (rows.length === 0) return;
    downloadFile(
      fileName.replace(/\.parquet$/i, '') + '.preview.json',
      JSON.stringify(toJsonSafe(rows), null, 2),
      'application/json',
    );
    notify(`Exported ${rows.length} preview rows as JSON`, 'success');
  }, [rows, fileName, notify]);

  const truncated = meta ? rows.length < Number(meta.totalRows) : false;

  return (
    <div className="reader">
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="table" size={15} /> Parquet file
          </h2>
          {fileName && <RowCountLabel shown={rows.length} total={Number(meta?.totalRows)} />}
        </header>
        <div className="panel-body">
          <DropZone
            accept=".parquet,.pq,.pqt,application/octet-stream"
            onFile={onFile}
            hint="Footer-first reading — only the first 500 rows decode into memory."
          />
          {fileName && bytes && (
            <FileMetaChips
              fileName={fileName}
              fileSize={bytes.length}
              extra={[
                ...(meta ? [`${Number(meta.totalRows).toLocaleString()} rows`] : []),
                ...(meta ? [`${meta.columns.length} columns`] : []),
                ...(meta && meta.codecs.length > 0
                  ? [`codec: ${meta.codecs.map(codecLabel).join(', ')}`]
                  : []),
              ]}
            />
          )}
          {loading && <p className="empty-hint">Reading the Parquet footer…</p>}
          {loadError && !loading && (
            <div className="error-card">
              <div className="error-title">
                <Icon name="alert" size={15} /> Could not read this Parquet file
              </div>
              <p className="error-message">{loadError.message}</p>
            </div>
          )}
        </div>
      </section>

      {meta && (
        <section className="panel">
          <header className="panel-head">
            <div className="tabs" role="tablist" aria-label="Parquet views">
              {['rows', 'schema', 'groups'].map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'tab is-active' : 'tab'}
                  onClick={() => setTab(id)}
                >
                  {id === 'rows' ? 'Rows' : id === 'schema' ? 'Schema' : 'Row groups'}
                </button>
              ))}
            </div>
            <button type="button" className="mini-btn" onClick={exportJson} disabled={rows.length === 0}>
              <Icon name="download" size={13} /> JSON
            </button>
          </header>
          {tab === 'rows' && (
            <div className="panel-body">
              <ColumnPicker meta={meta} columns={columns} onToggle={toggleColumn} onReload={reloadPreview} />
              {loadingRows ? (
                <p className="empty-hint">Decoding the first rows…</p>
              ) : (
                <RecordsTable rows={rows} totalRows={Number(meta.totalRows)} truncated={truncated} />
              )}
            </div>
          )}
          {tab === 'schema' && (
            <div className="panel-body">
              <SchemaView node={meta.schemaTree} />
              {meta.createdBy && <p className="panel-hint">Written by {meta.createdBy}</p>}
            </div>
          )}
          {tab === 'groups' && (
            <div className="panel-body">
              <CollapsedList
                items={meta.rowGroups}
                limit={8}
                render={(group) => (
                  <span>
                    Group {group.index}: {group.rows.toLocaleString()} rows · {group.columns} columns ·{' '}
                    {group.codecs.map(codecLabel).join(', ')}
                  </span>
                )}
              />
            </div>
          )}
        </section>
      )}
      {!notifyProp && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function ColumnPicker({ meta, columns, onToggle, onReload }) {
  const [open, setOpen] = useState(false);
  const active = columns ?? meta.columns.map((c) => c.name);
  const all = meta.columns.map((c) => c.name);
  return (
    <div className="column-picker">
      <button type="button" className="mini-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="table" size={13} /> Columns ({active.length}/{all.length})
      </button>
      {columns !== null && (
        <button type="button" className="mini-btn" onClick={onReload} title="Re-decode with only these columns">
          Apply projection
        </button>
      )}
      {open && (
        <div className="column-list">
          {meta.columns.map((col) => (
            <label key={col.name} className="column-item" title={col.label}>
              <input type="checkbox" checked={active.includes(col.name)} onChange={() => onToggle(col.name)} />
              <code>{col.name}</code>
              <span className="panel-hint">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

