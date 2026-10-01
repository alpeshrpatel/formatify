import { useCallback, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { downloadFile } from '../shared/binaryUtils.js';
import { generatePayload } from './jsonDataGenerator.js';

const MAX_RECORDS = 500;
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

export default function JsonGeneratorPanel({ onSendToEditor, notify }) {
  const [schemaText, setSchemaText] = useState(STARTER_SCHEMA);
  const [count, setCount] = useState(10);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setError('');
    setGenerating(true);
    try {
      const schema = JSON.parse(schemaText);
      const records = await generatePayload(schema, count);
      setOutput(JSON.stringify(records, null, 2));
      notify?.(`Generated ${records.length} API payloads`, 'success');
    } catch (cause) {
      setOutput('');
      setError(cause instanceof Error ? cause.message : 'Could not generate payloads from this schema.');
    } finally {
      setGenerating(false);
    }
  }, [count, notify, schemaText]);

  const handleSchemaChange = (event) => {
    setSchemaText(event.target.value);
    setOutput('');
    setError('');
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      notify?.('Generated payload copied to the clipboard', 'success');
    } catch {
      notify?.('The browser blocked clipboard access — select and copy manually', 'error');
    }
  }, [notify, output]);

  const handleDownload = useCallback(() => {
    downloadFile('api-payload.json', output, 'application/json');
    notify?.('Downloaded api-payload.json', 'success');
  }, [notify, output]);

  const handleSendToEditor = useCallback(() => {
    onSendToEditor(output, 'generated API payload');
  }, [onSendToEditor, output]);

  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_RECORDS;

  return (
    <div className="generator-panel">
      <div className="generator-toolbar">
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
              setOutput('');
            }}
          />
        </label>
        <span className="panel-hint">1 to {MAX_RECORDS} records per generation</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={!validCount || generating}
        >
          <Icon name="wand" size={14} /> {generating ? 'Generating…' : 'Generate payload'}
        </button>
      </div>

      <div className="generator-grid">
        <label className="generator-schema">
          <span className="diff-input-label">JSON Schema</span>
          <textarea
            className="diff-textarea generator-schema-input"
            value={schemaText}
            onChange={handleSchemaChange}
            spellCheck={false}
            aria-label="Payload JSON Schema"
          />
        </label>

        <section className="generator-result" aria-label="Generated payload preview">
          <div className="generator-result-head">
            <span className="diff-input-label">Generated JSON</span>
            {output && (
              <div className="generator-actions">
                <button type="button" className="mini-btn" onClick={handleCopy}>
                  <Icon name="copy" size={13} /> Copy
                </button>
                <button type="button" className="mini-btn" onClick={handleDownload}>
                  <Icon name="download" size={13} /> Download
                </button>
                <button type="button" className="mini-btn" onClick={handleSendToEditor}>
                  <Icon name="braces" size={13} /> Send to editor
                </button>
              </div>
            )}
          </div>
          {error ? (
            <div className="jsonpath-error">
              <Icon name="alert" size={14} />
              <span>{error}</span>
            </div>
          ) : output ? (
            <pre className="generator-output"><code>{output}</code></pre>
          ) : (
            <p className="empty-hint">Enter a JSON Schema and generate a payload preview.</p>
          )}
        </section>
      </div>
    </div>
  );
}