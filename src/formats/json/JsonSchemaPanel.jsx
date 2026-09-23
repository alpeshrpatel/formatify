import { useCallback, useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { beautifyJson } from './jsonFormatter.js';
import { validateJson } from './jsonParser.js';
import { inferSchema, validateJsonSchema } from './jsonSchemaValidate.js';

const DEFAULT_SCHEMA = `{
  "type": "object",
  "required": [],
  "properties": {}
}`;

/**
 * JSON Schema validation panel.
 *
 * Paste a JSON Schema (draft-07) and the current document is checked against
 * it as you type. When no schema is supplied the panel can generate one from
 * the document itself via `inferSchema`, which is a handy starting point for
 * documenting an undocumented payload.
 */
export default function JsonSchemaPanel({ data, onSendToEditor, notify }) {
  const [schemaText, setSchemaText] = useState(DEFAULT_SCHEMA);

  // Ask the parser for the current document's inferred schema on demand.
  const inferred = useMemo(() => {
    if (data === undefined) return null;
    try {
      return beautifyJson(JSON.stringify(inferSchema(data)), { indent: 2 });
    } catch {
      return null;
    }
  }, [data]);

  const parsedSchema = useMemo(() => validateJson(schemaText), [schemaText]);

  const result = useMemo(() => {
    if (!parsedSchema.ok || data === undefined) return null;
    return validateJsonSchema(data, parsedSchema.value);
  }, [parsedSchema.ok, parsedSchema.value, data]);

  const handleInfer = useCallback(() => {
    if (!inferred) return;
    setSchemaText(inferred);
    notify?.('Schema inferred from the current document', 'success');
  }, [inferred, notify]);

  const handleCopySchema = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(schemaText);
      notify?.('Schema copied to the clipboard', 'success');
    } catch {
      notify?.('The browser blocked clipboard access — select and copy manually', 'error');
    }
  }, [schemaText, notify]);


  const handleSendToEditor = useCallback(() => {
    onSendToEditor(schemaText, 'inferred JSON schema');
  }, [schemaText, onSendToEditor]);

  const errorCount = result?.errors?.length ?? 0;

  return (
    <div className="schema-panel">
      <div className="schema-toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleInfer}
          disabled={!inferred}
          title="Generate a schema that describes the current document"
        >
          <Icon name="wand" size={14} /> Infer schema from document
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleCopySchema}>
          <Icon name="copy" size={14} /> Copy schema
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleSendToEditor}>
          <Icon name="braces" size={14} /> Send schema to editor
        </button>
      </div>

      {result && (
        <div className={result.valid ? 'schema-status is-valid' : 'schema-status is-invalid'}>
          <Icon name={result.valid ? 'check' : 'alert'} size={15} />
          <strong>
            {result.valid
              ? 'The document is valid against this schema.'
              : `The document does not match this schema — ${errorCount} problem${errorCount === 1 ? '' : 's'} found.`}
          </strong>
        </div>
      )}

      <label className="schema-editor-row">
        <span className="diff-input-label">
          <Icon name="schema" size={14} />
          JSON Schema (draft-07)
        </span>
        <textarea
          className="diff-textarea schema-textarea"
          value={schemaText}
          onChange={(event) => setSchemaText(event.target.value)}
          spellCheck={false}
          rows={10}
          aria-label="JSON Schema"
        />
      </label>

      {!parsedSchema.ok && (
        <div className="jsonpath-error">
          <Icon name="alert" size={14} />
          <span>The schema itself is not valid JSON: {parsedSchema.error?.message}</span>
        </div>
      )}

      {parsedSchema.ok && result && !result.valid && (
        <ul className="schema-error-list">
          {result.errors.map((problem, index) => (
            <li key={`${problem.path}-${problem.keyword}-${index}`} className="schema-error">
              <span className="diff-badge is-removed">{problem.keyword ?? 'error'}</span>
              <code className="diff-path">{problem.path}</code>
              <span className="schema-error-message">{problem.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
