import { useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { diffLines, diffValues } from './jsonDiff.js';
import { beautifyJson } from './jsonFormatter.js';
import { validateJson } from './jsonParser.js';

/**
 * JSON Diff Viewer.
 *
 * Compares the document in the editor (side A) against a second document
 * (side B) that the user can paste or load here. Two views are offered:
 *
 *   - a structural diff (`diffValues`) that reports added, removed and
 *     changed paths, which is what you usually want for JSON; and
 *   - a unified line diff (`diffLines`) for eyeballing the raw text.
 *
 * Everything runs locally in the browser — nothing is uploaded.
 */
export default function JsonDiffPanel({ data, text }) {
  const [compareText, setCompareText] = useState('');
  const [mode, setMode] = useState('structural');

  const compare = useMemo(() => validateJson(compareText), [compareText]);

  const prettySelf = useMemo(() => {
    try {
      return beautifyJson(text, { indent: 2 });
    } catch {
      return text;
    }
  }, [text]);

  const prettyOther = useMemo(() => {
    if (!compare.ok) return compareText;
    try {
      return beautifyJson(compareText, { indent: 2 });
    } catch {
      return compareText;
    }
  }, [compareText, compare.ok]);

  const lineOps = useMemo(
    () => (compare.ok ? diffLines(prettySelf, prettyOther) : []),
    [compare.ok, prettySelf, prettyOther],
  );

  const changes = useMemo(
    () => (compare.ok && data !== undefined ? diffValues(data, compare.value) : []),
    [compare.ok, data, compare.value],
  );

  const counts = useMemo(() => {
    const acc = { added: 0, removed: 0, changed: 0, equ: 0, add: 0, del: 0 };
    for (const change of changes) {
      if (change.kind === 'added') acc.added += 1;
      else if (change.kind === 'removed') acc.removed += 1;
      else if (change.kind === 'changed') acc.changed += 1;
    }
    for (const op of lineOps) acc[op.kind] = (acc[op.kind] ?? 0) + 1;
    return acc;
  }, [changes, lineOps]);

  const hasBaseline = compareText.trim().length > 0;
  const total = counts.added + counts.removed + counts.changed;


  return (
    <div className="diff-panel">
      <div className="diff-toolbar">
        <div className="chip-row" role="group" aria-label="Diff mode">
          <button
            type="button"
            className={mode === 'structural' ? 'chip is-on' : 'chip'}
            aria-pressed={mode === 'structural'}
            onClick={() => setMode('structural')}
          >
            Structural
          </button>
          <button
            type="button"
            className={mode === 'lines' ? 'chip is-on' : 'chip'}
            aria-pressed={mode === 'lines'}
            onClick={() => setMode('lines')}
          >
            Lines
          </button>
        </div>

        {hasBaseline && compare.ok && (
          <div className="diff-summary">
            <span className="diff-chip is-added">+{counts.added} added</span>
            <span className="diff-chip is-removed">−{counts.removed} removed</span>
            <span className="diff-chip is-changed">~{counts.changed} changed</span>
          </div>
        )}
      </div>

      <label className="diff-input-row">
        <span className="diff-input-label">
          <Icon name="diff" size={14} />
          Compare against
        </span>
        <textarea
          className="diff-textarea"
          value={compareText}
          onChange={(event) => setCompareText(event.target.value)}
          placeholder={'Paste the second JSON document here…'}
          spellCheck={false}
          rows={4}
          aria-label="The JSON document to compare against"
        />
      </label>

      {!hasBaseline ? (
        <div className="diff-body">
          <p className="empty-hint">
            Paste a second JSON document above to see what changed. Both documents are
            compared locally — nothing leaves your machine.
          </p>
        </div>
      ) : !compare.ok ? (
        <div className="jsonpath-error">
          <Icon name="alert" size={14} />
          <span>The comparison document is not valid JSON: {compare.error?.message}</span>
        </div>
      ) : mode === 'structural' ? (
        <StructuralDiff changes={changes} total={total} />
      ) : (
        <LineDiff ops={lineOps} />
      )}
    </div>
  );
}

/** Object-path diff: one row per added, removed or changed path. */
function StructuralDiff({ changes, total }) {
  if (total === 0) {
    return (
      <div className="diff-body">
        <p className="diff-identical">
          <Icon name="check" size={14} /> The two documents are structurally identical.
        </p>
      </div>
    );
  }
  return (
    <div className="diff-body">
      <ul className="diff-change-list">
        {changes.map((change, index) => (
          <li
            key={`${change.path}-${change.kind}-${index}`}
            className={`diff-change is-${change.kind}`}
          >
            <span className={`diff-badge is-${change.kind}`}>{change.kind}</span>
            <code className="diff-path">{change.path}</code>
            <span className="diff-values">
              {change.kind !== 'added' && (
                <span className="diff-old">{preview(change.old)}</span>
              )}
              {change.kind === 'changed' && <Icon name="chevronRight" size={12} />}
              {change.kind !== 'removed' && (
                <span className="diff-new">{preview(change.new)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Unified line diff over the two pretty-printed documents. */
function LineDiff({ ops }) {
  return (
    <div className="diff-body">
      <pre className="diff-lines">
        {ops.map((op, index) => (
          <div key={index} className={`diff-line is-${op.kind}`}>
            <span className="diff-sign">
              {op.kind === 'add' ? '+' : op.kind === 'del' ? '−' : ' '}
            </span>
            <code>{op.line}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Render a compact one-line preview of any JSON value. */
function preview(value) {
  if (value === undefined) return 'undefined';
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

