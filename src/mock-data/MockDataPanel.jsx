import { useCallback, useRef, useState } from 'react';

import Icon from '../components/Icon.jsx';
import { downloadFile, formatBytes } from '../formats/shared/binaryUtils.js';
import { toAvroBuffer, toCsv, toParquetBuffer, toYaml } from '../formats/json/jsonConvert.js';
import { generatePayload, inferSchemaFromPayload } from './generatePayload.js';
import { parseOpenApiSpec } from './openApi.js';

const MAX_RECORDS = 500;
const OUTPUT_FORMATS = [
  { id: 'json', label: 'JSON', extension: 'json', mime: 'application/json' },
  { id: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv;charset=utf-8' },
  { id: 'yaml', label: 'YAML', extension: 'yaml', mime: 'text/yaml;charset=utf-8' },
  { id: 'parquet', label: 'Parquet', extension: 'parquet', mime: 'application/parquet' },
  { id: 'avro', label: 'Avro', extension: 'avro', mime: 'application/avro' },
];

const STARTER_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "name", "email", "status"],
  "properties": {
    "id": { "type": "integer", "minimum": 1000, "maximum": 9999 },
    "name": { "type": "string", "faker": "person.fullName" },
    "email": { "type": "string", "format": "email" },
    "status": { "type": "string", "enum": ["active", "pending", "disabled"] },
    "createdAt": { "type": "string", "format": "date-time" },
    "address": {
      "type": "object",
      "properties": {
        "street": { "type": "string", "faker": "location.streetAddress" },
        "city": { "type": "string", "faker": "location.city" },
        "country": { "type": "string", "faker": "location.country" }
      }
    },
    "orders": {
      "type": "array",
      "minItems": 1,
      "maxItems": 3,
      "items": {
        "type": "object",
        "required": ["sku", "quantity"],
        "properties": {
          "sku": { "type": "string", "faker": "string.alphanumeric" },
          "quantity": { "type": "integer", "minimum": 1, "maximum": 5 }
        }
      }
    }
  }
}`;

const STARTER_PAYLOAD = `{
  "id": 1001,
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "status": "active",
  "address": { "city": "London", "country": "UK" },
  "orders": [{ "sku": "KB-1", "quantity": 2 }]
}`;

export default function MockDataPanel({ notify, onSendToEditor }) {
  const [schemaText, setSchemaText] = useState(STARTER_SCHEMA);
  const [payloadText, setPayloadText] = useState(STARTER_PAYLOAD);
  const [schemaInput, setSchemaInput] = useState('schema');
  const [schemaError, setSchemaError] = useState('');
  const [openApiText, setOpenApiText] = useState('');
  const [openApiDocument, setOpenApiDocument] = useState(null);
  const [operationId, setOperationId] = useState('');
  const [schemaOptionId, setSchemaOptionId] = useState('');
  const [count, setCount] = useState(10);
  const [outputFormat, setOutputFormat] = useState('json');
  const [artifact, setArtifact] = useState(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loadingOpenApi, setLoadingOpenApi] = useState(false);
  const openApiFileRef = useRef(null);

  const selectedOperation = openApiDocument?.operations.find((operation) => operation.id === operationId);
  const selectedSchemaOption = selectedOperation?.schemaOptions.find((option) => option.id === schemaOptionId);

  const handleGenerate = useCallback(async () => {
    setError('');
    setArtifact(null);
    setGenerating(true);
    try {
      const schema = schemaInput === 'openapi' ? selectedSchemaOption?.schema : JSON.parse(schemaText);
      if (!schema) throw new Error('Load an OpenAPI spec and choose an operation payload schema first.');
      const records = await generatePayload(schema, count);
      const format = OUTPUT_FORMATS.find((entry) => entry.id === outputFormat);
      const fileName = `api-payload.${format.extension}`;
      if (outputFormat === 'json') {
        const content = JSON.stringify(records, null, 2);
        setArtifact({ format, fileName, content, preview: content, recordCount: records.length });
      } else if (outputFormat === 'csv') {
        const content = toCsv(records);
        setArtifact({ format, fileName, content, preview: content, recordCount: records.length });
      } else if (outputFormat === 'yaml') {
        const content = await toYaml(records);
        setArtifact({ format, fileName, content, preview: content, recordCount: records.length });
      } else {
        const content = outputFormat === 'parquet'
          ? await toParquetBuffer(records)
          : await toAvroBuffer(records);
        setArtifact({
          format,
          fileName,
          content,
          preview: JSON.stringify(records.slice(0, 3), null, 2),
          recordCount: records.length,
        });
      }
      notify?.(`Generated ${records.length} ${format.label} payload records`, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not generate payloads from this schema.');
    } finally {
      setGenerating(false);
    }
  }, [count, notify, outputFormat, schemaInput, schemaText, selectedSchemaOption]);

  const handleInferSchema = useCallback(() => {
    try {
      const inferred = inferSchemaFromPayload(payloadText);
      setSchemaText(JSON.stringify(inferred, null, 2));
      setSchemaInput('schema');
      setSchemaError('');
      setArtifact(null);
      notify?.('JSON Schema inferred from the example payload', 'success');
    } catch (cause) {
      setSchemaError(cause instanceof Error ? cause.message : 'The example payload is not valid JSON.');
    }
  }, [notify, payloadText]);

  const handleLoadOpenApi = useCallback(async () => {
    setSchemaError('');
    setLoadingOpenApi(true);
    try {
      const document = await parseOpenApiSpec(openApiText);
      const firstOperation = document.operations[0];
      setOpenApiDocument(document);
      setOperationId(firstOperation.id);
      setSchemaOptionId(firstOperation.schemaOptions[0].id);
      setArtifact(null);
      notify?.(`Loaded ${document.title} · ${document.operations.length} operations`, 'success');
    } catch (cause) {
      setOpenApiDocument(null);
      setOperationId('');
      setSchemaOptionId('');
      setSchemaError(cause instanceof Error ? cause.message : 'Could not read this OpenAPI document.');
    } finally {
      setLoadingOpenApi(false);
    }
  }, [notify, openApiText]);

  const handleOpenApiFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setOpenApiText(await file.text());
      setOpenApiDocument(null);
      setOperationId('');
      setSchemaOptionId('');
      setSchemaError('');
      setArtifact(null);
    } catch (cause) {
      setSchemaError(cause instanceof Error ? cause.message : 'Could not read that OpenAPI file.');
    } finally {
      event.target.value = '';
    }
  }, []);

  const handleOperationChange = (event) => {
    const nextId = event.target.value;
    const operation = openApiDocument?.operations.find((entry) => entry.id === nextId);
    setOperationId(nextId);
    setSchemaOptionId(operation?.schemaOptions[0]?.id ?? '');
    setArtifact(null);
  };

  const handleEditOpenApiSchema = () => {
    if (!selectedSchemaOption) return;
    setSchemaText(JSON.stringify(selectedSchemaOption.schema, null, 2));
    setSchemaInput('schema');
    setSchemaError('');
    setArtifact(null);
  };

  const handleCopy = useCallback(async () => {
    if (typeof artifact?.content !== 'string') return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      notify?.(`${artifact.format.label} output copied to the clipboard`, 'success');
    } catch {
      notify?.('The browser blocked clipboard access — select and copy manually', 'error');
    }
  }, [artifact, notify]);

  const handleDownload = useCallback(() => {
    if (!artifact) return;
    downloadFile(artifact.fileName, artifact.content, artifact.format.mime);
    notify?.(`Downloaded ${artifact.fileName}`, 'success');
  }, [artifact, notify]);

  const handleSendToEditor = useCallback(() => {
    if (artifact?.format.id === 'json') onSendToEditor?.(artifact.content);
  }, [artifact, onSendToEditor]);

  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_RECORDS;
  const canGenerate = validCount && !generating && (schemaInput !== 'openapi' || Boolean(selectedSchemaOption));
  const isBinary = artifact && (artifact.format.id === 'parquet' || artifact.format.id === 'avro');

  return (
    <div className="mock-data-panel">
      <div className="mock-data-toolbar">
        <label className="generator-count">
          <span>Records</span>
          <input
            aria-label="Number of records"
            type="number"
            min="1"
            max={MAX_RECORDS}
            step="1"
            value={count}
            onChange={(event) => {
              setCount(Number(event.target.value));
              setArtifact(null);
            }}
          />
        </label>
        <span className="panel-hint">1 to {MAX_RECORDS} records</span>
        <div className="mock-data-formats" role="group" aria-label="Output format">
          {OUTPUT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              className={outputFormat === format.id ? 'chip is-on' : 'chip'}
              aria-pressed={outputFormat === format.id}
              onClick={() => {
                setOutputFormat(format.id);
                setArtifact(null);
              }}
            >
              {format.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={!canGenerate}
        >
          <Icon name="wand" size={14} /> {generating ? 'Generating…' : 'Generate payload'}
        </button>
      </div>

      <div className="mock-data-grid">
        <section className="mock-data-schema">
          <div className="mock-data-input-head">
            <span className="diff-input-label">
              {schemaInput === 'schema'
                ? 'JSON Schema'
                : schemaInput === 'payload'
                  ? 'Example JSON payload'
                  : 'OpenAPI specification'}
            </span>
            <div className="mock-data-input-actions">
              <div className="mock-data-input-modes" role="group" aria-label="Schema input mode">
                <button
                  type="button"
                  className={schemaInput === 'schema' ? 'chip is-on' : 'chip'}
                  aria-pressed={schemaInput === 'schema'}
                  onClick={() => setSchemaInput('schema')}
                >
                  Schema
                </button>
                <button
                  type="button"
                  className={schemaInput === 'payload' ? 'chip is-on' : 'chip'}
                  aria-pressed={schemaInput === 'payload'}
                  onClick={() => setSchemaInput('payload')}
                >
                  Example JSON
                </button>
                <button
                  type="button"
                  className={schemaInput === 'openapi' ? 'chip is-on' : 'chip'}
                  aria-pressed={schemaInput === 'openapi'}
                  onClick={() => setSchemaInput('openapi')}
                >
                  OpenAPI
                </button>
              </div>
              {schemaInput === 'payload' && (
                <button type="button" className="mini-btn" onClick={handleInferSchema}>
                  <Icon name="wand" size={13} /> Infer schema
                </button>
              )}
              {schemaInput === 'openapi' && (
                <>
                  <input
                    ref={openApiFileRef}
                    className="visually-hidden"
                    type="file"
                    accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
                    onChange={handleOpenApiFile}
                    aria-label="Import OpenAPI file"
                  />
                  <button type="button" className="mini-btn" onClick={() => openApiFileRef.current?.click()}>
                    <Icon name="upload" size={13} /> Import file
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={handleLoadOpenApi}
                    disabled={!openApiText.trim() || loadingOpenApi}
                  >
                    <Icon name="schema" size={13} /> {loadingOpenApi ? 'Loading…' : 'Load endpoints'}
                  </button>
                </>
              )}
            </div>
          </div>
          {schemaInput === 'schema' ? (
            <textarea
              className="diff-textarea mock-data-schema-input"
              value={schemaText}
              onChange={(event) => {
                setSchemaText(event.target.value);
                setArtifact(null);
                setError('');
              }}
              spellCheck={false}
              aria-label="Payload JSON Schema"
            />
          ) : schemaInput === 'payload' ? (
            <textarea
              className="diff-textarea mock-data-schema-input"
              value={payloadText}
              onChange={(event) => {
                setPayloadText(event.target.value);
                setSchemaError('');
              }}
              spellCheck={false}
              aria-label="Example JSON payload"
            />
          ) : (
            <>
              <textarea
                className="diff-textarea mock-data-schema-input"
                value={openApiText}
                onChange={(event) => {
                  setOpenApiText(event.target.value);
                  setOpenApiDocument(null);
                  setOperationId('');
                  setSchemaOptionId('');
                  setArtifact(null);
                  setSchemaError('');
                }}
                spellCheck={false}
                aria-label="OpenAPI specification"
                placeholder="Paste an OpenAPI 3.x JSON or YAML document"
              />
              {openApiDocument && (
                <div className="mock-data-openapi-selectors">
                  <label className="mock-data-select-label">
                    <span>Operation</span>
                    <select aria-label="OpenAPI operation" value={operationId} onChange={handleOperationChange}>
                      {openApiDocument.operations.map((operation) => (
                        <option key={operation.id} value={operation.id}>{operation.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mock-data-select-label">
                    <span>Payload schema</span>
                    <select
                      aria-label="OpenAPI payload schema"
                      value={schemaOptionId}
                      onChange={(event) => {
                        setSchemaOptionId(event.target.value);
                        setArtifact(null);
                      }}
                    >
                      {selectedOperation?.schemaOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {selectedOperation?.summary && <span className="panel-hint">{selectedOperation.summary}</span>}
                  {selectedSchemaOption && (
                    <details className="mock-data-openapi-schema">
                      <summary>Selected schema</summary>
                      <button type="button" className="mini-btn" onClick={handleEditOpenApiSchema}>
                        Edit schema
                      </button>
                      <pre className="generator-output"><code>{JSON.stringify(selectedSchemaOption.schema, null, 2)}</code></pre>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          {schemaError && <p className="mock-data-schema-error">{schemaError}</p>}
        </section>

        <section className="mock-data-result" aria-label="Generated payload preview">
          <div className="mock-data-result-head">
            <span className="diff-input-label">
              {artifact ? `${artifact.format.label} output` : `${OUTPUT_FORMATS.find((format) => format.id === outputFormat).label} output`}
            </span>
            {artifact && (
              <div className="generator-actions">
                {!isBinary && (
                  <button type="button" className="mini-btn" onClick={handleCopy}>
                    <Icon name="copy" size={13} /> Copy
                  </button>
                )}
                {artifact.format.id === 'json' && (
                  <button type="button" className="mini-btn" onClick={handleSendToEditor}>
                    <Icon name="braces" size={13} /> Send to editor
                  </button>
                )}
                <button type="button" className="mini-btn" onClick={handleDownload}>
                  <Icon name="download" size={13} /> Download
                </button>
              </div>
            )}
          </div>
          {error ? (
            <div className="jsonpath-error">
              <Icon name="alert" size={14} />
              <span>{error}</span>
            </div>
          ) : artifact ? (
            <>
              <span className="panel-hint mock-data-summary">
                {artifact.recordCount.toLocaleString()} records
                {isBinary ? ` · ${formatBytes(artifact.content.byteLength)} binary file` : ''}
              </span>
              {isBinary && <p className="empty-hint">Sample records (first {Math.min(3, artifact.recordCount)}):</p>}
              <pre className="generator-output"><code>{artifact.preview}</code></pre>
            </>
          ) : (
            <p className="empty-hint">Define a schema, choose an output format, and generate a payload.</p>
          )}
        </section>
      </div>
    </div>
  );
}