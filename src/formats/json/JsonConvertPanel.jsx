import { useCallback, useEffect, useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { fromCsv, fromXml, fromYaml, toCsv, toXml, toYaml } from './jsonConvert.js';
import { beautifyJson } from './jsonFormatter.js';
import { validateJson } from './jsonParser.js';

const TARGETS = [
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML' },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
];

/**
 * Conversion workspace: turn the parsed document into YAML, XML or CSV, or
 * parse a YAML / XML / CSV snippet back into JSON.
 *
 * All conversions are performed by the pure helpers in `jsonConvert.js`, so
 * the whole panel runs offline inside the browser tab.
 */
export default function JsonConvertPanel({ data, onSendToEditor, notify }) {
  const [target, setTarget] = useState('yaml');
  const [output, setOutput] = useState('');
  const [error, setError] = useState(null);
  const [source, setSource] = useState('');
  const [sourceFormat, setSourceFormat] = useState('yaml');

  const runForward = useCallback(async (value, format) => {
    try {
      setError(null);
      if (format === 'yaml') {
        setOutput(await toYaml(value));
      } else if (format === 'xml') {
        setOutput(toXml(value));
      } else if (format === 'csv') {
        const csv = toCsv(value);
        if (!csv) {
          setOutput('');
          setError('CSV needs a non-empty array of objects at the top level.');
          return;
        }
        setOutput(csv);
      } else {
        setOutput(beautifyJson(JSON.stringify(value), { indent: 2 }));
      }
    } catch (err) {
      setOutput('');
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (data === undefined) return;
    runForward(data, target);
  }, [data, target, runForward]);

  const handleParse = useCallback(async () => {
    try {
      setError(null);
      let value;
      if (sourceFormat === 'yaml') value = await fromYaml(source);
      else if (sourceFormat === 'xml') value = fromXml(source);
      else if (sourceFormat === 'csv') value = fromCsv(source);
      else {
        const parsed = validateJson(source);
        if (!parsed.ok) throw new Error(parsed.error?.message ?? 'Invalid JSON');
        value = parsed.value;
      }
      onSendToEditor(beautifyJson(JSON.stringify(value ?? null), { indent: 2 }), `${sourceFormat} → JSON`);
      notify?.(`Converted ${sourceFormat.toUpperCase()} to JSON in the editor`, 'success');
    } catch (err) {
      setError(err.message);
    }
  }, [source, sourceFormat, onSendToEditor, notify]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      notify?.('Converted output copied to the clipboard', 'success');
    } catch {
      notify?.('The browser blocked clipboard access — select and copy manually', 'error');
    }
  }, [output, notify]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `formatify.${target === 'json' ? 'json' : target === 'yaml' ? 'yaml' : target}`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify?.(`Downloaded as ${target.toUpperCase()}`, 'success');
  }, [output, target, notify]);

  const lineCount = useMemo(() => (output ? output.split('\n').length : 0), [output]);


  return (
    <div className="convert-panel">
      <section className="convert-section">
        <header className="convert-head">
          <Icon name="convert" size={15} />
          <h3>JSON → another format</h3>
        </header>

        <div className="chip-row" role="group" aria-label="Target format">
          {TARGETS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={target === option.id ? 'chip is-on' : 'chip'}
              aria-pressed={target === option.id}
              onClick={() => setTarget(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="jsonpath-error">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        )}

        {!error && output && (
          <>
            <div className="convert-actions">
              <span className="panel-hint">
                {lineCount} line{lineCount === 1 ? '' : 's'} · {target.toUpperCase()}
              </span>
              <button type="button" className="btn btn-ghost" onClick={handleCopy}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleDownload}>
                <Icon name="download" size={14} /> Download
              </button>
            </div>
            <pre className="convert-output"><code>{output}</code></pre>
          </>
        )}

        {!error && !output && (
          <p className="empty-hint">
            Load valid JSON on the left, then pick a target format above.
          </p>
        )}
      </section>

      <section className="convert-section">
        <header className="convert-head">
          <Icon name="upload" size={15} />
          <h3>Another format → JSON</h3>
        </header>

        <div className="chip-row" role="group" aria-label="Source format">
          {TARGETS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={sourceFormat === option.id ? 'chip is-on' : 'chip'}
              aria-pressed={sourceFormat === option.id}
              onClick={() => setSourceFormat(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <textarea
          className="diff-textarea"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={`Paste ${sourceFormat.toUpperCase()} here…`}
          spellCheck={false}
          rows={5}
          aria-label={`${sourceFormat.toUpperCase()} source`}
        />

        <div className="convert-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleParse}
            disabled={!source.trim()}
          >
            <Icon name="braces" size={14} /> Load as JSON
          </button>
        </div>
      </section>
    </div>
  );
}
