import { useCallback, useEffect, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import Toast from '../../components/Toast.jsx';
import { downloadFile, readFileBytes, restoreNestedJsonStrings, toJsonSafe } from '../shared/binaryUtils.js';
import DropZone from '../shared/DropZone.jsx';
import { FileMetaChips, RowCountLabel } from '../shared/RecordsMeta.jsx';
import RecordsTable from '../shared/RecordsTable.jsx';
import SchemaView, { CollapsedList } from '../shared/SchemaView.jsx';
import { avroSchemaToTree, readAvroHeader, readAvroPreview, scanAvroBlocks } from './avroReader.js';

export const PREVIEW_LIMIT = 500;

/**
 * The Avro workspace: header metadata + schema tree + paged row preview.
 * Records are decoded block by block; only the first PREVIEW_LIMIT rows
 * materialise in memory so huge container files stay responsive.
 */
export default function AvroPanel({ notify: notifyProp, openRequest }) {
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState(null);
  const [header, setHeader] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [rows, setRows] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [tab, setTab] = useState('rows');
  const [toast, setToast] = useState(null);

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
      setFileName(name ?? 'dropped.avro');
      setBytes(nextBytes);
      setHeader(null);
      setBlocks([]);
      setRows([]);
      setTruncated(false);
      setLoadError(null);
      setTab('rows');
      setLoading(true);
      try {
        const nextHeader = readAvroHeader(nextBytes);
        setHeader(nextHeader);
        setBlocks(scanAvroBlocks(nextBytes, nextHeader));
        setLoadingRows(true);
        try {
          const preview = await readAvroPreview(nextBytes, { limit: PREVIEW_LIMIT });
          setRows(preview.records);
          setTruncated(preview.truncated);
        } finally {
          setLoadingRows(false);
        }
        notify(
          `Loaded ${name ?? 'file'} — schema "${schemaName(nextHeader.schema)}" · codec ${nextHeader.codec}`,
          'success',
        );
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
        notify(cause?.message ?? 'Could not read that Avro file', 'error');
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

  const openId = openRequest?.id;
  const openBytes = openRequest?.bytes;
  const openName = openRequest?.fileName;
  useEffect(() => {
    if (openBytes) loadBytes(openBytes, openName);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportJson = useCallback(() => {
    if (rows.length === 0) return;
    const json = JSON.stringify(toJsonSafe(restoreNestedJsonStrings(rows)), null, 2);
    downloadFile(
      fileName.replace(/\.avro$/i, '') + '.preview.json',
      json,
      'application/json',
    );
    notify(`Exported ${rows.length} preview rows as JSON`, 'success');
  }, [rows, fileName, notify]);

  const jsonOutput = JSON.stringify(toJsonSafe(restoreNestedJsonStrings(rows)), null, 2);
  const copyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonOutput);
      notify('Copied JSON preview to the clipboard', 'success');
    } catch {
      notify('The browser blocked clipboard access', 'error');
    }
  }, [jsonOutput, notify]);

  const schemaTree = header ? avroSchemaToTree(header.schema) : null;
  const blockRows = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  return (
    <div className="reader">
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="boxes" size={15} /> Avro file
          </h2>
          {header && <RowCountLabel shown={rows.length} total={blockRows || null} />}
        </header>
        <div className="panel-body">
          <DropZone
            accept=".avro,application/octet-stream"
            onFile={onFile}
            hint={`Decodes ${PREVIEW_LIMIT} records at a time — supports "null" and "deflate" codecs.`}
          />
          {fileName && bytes && (
            <FileMetaChips
              fileName={fileName}
              fileSize={bytes.length}
              extra={[
                ...(header ? [`schema: ${schemaName(header.schema)}`] : []),
                ...(header ? [`codec: ${header.codec}`] : []),
                ...(blocks.length > 0 ? [`${blocks.length} block${blocks.length === 1 ? '' : 's'}`] : []),
              ]}
            />
          )}
          {loading && <p className="empty-hint">Reading the Avro header…</p>}
          {loadError && !loading && (
            <div className="error-card">
              <div className="error-title">
                <Icon name="alert" size={15} /> Could not read this Avro file
              </div>
              <p className="error-message">{loadError.message}</p>
            </div>
          )}
        </div>
      </section>
      {header && (
        <section className="panel">
          <header className="panel-head">
            <div className="tabs" role="tablist" aria-label="Avro views">
              {['rows', 'json', 'schema', 'blocks', 'meta'].map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'tab is-active' : 'tab'}
                  onClick={() => setTab(id)}
                >
                  {id === 'rows'
                    ? 'Rows'
                    : id === 'json'
                      ? 'JSON'
                      : id === 'schema'
                        ? 'Schema'
                        : id === 'blocks'
                          ? 'Blocks'
                          : 'Metadata'}
                </button>
              ))}
            </div>
          </header>
          {tab === 'rows' && (
            <div className="panel-body">
              {loadingRows ? (
                <p className="empty-hint">Decoding the first records…</p>
              ) : (
                <RecordsTable rows={rows} truncated={truncated} />
              )}
            </div>
          )}
          {tab === 'json' && (
            <div className="panel-body json-preview">
              <div className="json-preview-toolbar">
                <span className="panel-hint">
                  Pretty-printed preview: {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
                  {truncated && blockRows > rows.length ? ` of ${blockRows.toLocaleString()}` : ''}
                </span>
                <div className="json-preview-actions">
                  <button type="button" className="mini-btn" onClick={copyJson} disabled={rows.length === 0}>
                    <Icon name="copy" size={13} /> Copy JSON
                  </button>
                  <button type="button" className="mini-btn" onClick={exportJson} disabled={rows.length === 0}>
                    <Icon name="download" size={13} /> Download JSON
                  </button>
                </div>
              </div>
              {rows.length > 0 ? (
                <pre className="json-preview-code" aria-label="Pretty-printed Avro JSON preview">
                  <code>{jsonOutput}</code>
                </pre>
              ) : (
                <p className="empty-hint">No Avro records to convert.</p>
              )}
            </div>
          )}
          {tab === 'schema' && (
            <div className="panel-body">
              <SchemaView node={schemaTree} />
            </div>
          )}
          {tab === 'blocks' && (
            <div className="panel-body">
              <CollapsedList
                items={blocks}
                limit={8}
                render={(block) => (
                  <span>
                    Block {block.index}: {block.count ?? '?'} record{block.count === 1 ? '' : 's'} ·{' '}
                    {block.byteSize.toLocaleString()} bytes · offset {block.offset.toLocaleString()}
                    {block.synced ? '' : ' · ⚠ sync marker mismatch'}
                  </span>
                )}
              />
              {blocks.length === 0 && <p className="empty-hint">This container has no data blocks.</p>}
            </div>
          )}
          {tab === 'meta' && (
            <div className="panel-body">
              <ul className="meta-list">
                {Object.entries(header.metaText).map(([key, value]) => (
                  <li key={key}>
                    <code>{key}</code>
                    {key === 'avro.schema' ? (
                      <pre className="meta-json">{beautifySchema(value)}</pre>
                    ) : (
                      <span className="cell-text">{value}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {!notifyProp && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function schemaName(schema) {
  if (Array.isArray(schema)) return 'union';
  if (typeof schema === 'string') return schema;
  return schema?.name ?? schema?.type ?? 'unknown';
}
