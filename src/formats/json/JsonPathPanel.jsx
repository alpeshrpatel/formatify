import { useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import JsonTree from './JsonTree.jsx';
import { jsonPath } from './jsonPath.js';

/**
 * Lightweight JSONPath query interface.
 *
 * The user types an expression (e.g. `$.store.book[*].title`) and the
 * results are rendered with the same collapsible tree used elsewhere.
 * All evaluation happens inside the same pure `jsonPath` function already
 * used by `jsonPath.js`, so this panel stays zero-dependency.
 */
export default function JsonPathPanel({ data }) {
  const [expr, setExpr] = useState('$.');

  const { results, count, error } = useMemo(() => {
    if (!data) return { results: [], count: 0, error: null };
    try {
      const out = jsonPath(data, expr);
      return { results: out, count: out.length, error: null };
    } catch (err) {
      return { results: [], count: 0, error: err.message };
    }
  }, [data, expr]);

  return (
    <div className="jsonpath-panel">
      <div className="jsonpath-query-row">
        <Icon name="search" size={15} />
        <input
          type="text"
          className="jsonpath-input"
          value={expr}
          onChange={(event) => setExpr(event.target.value)}
          placeholder="$.store.book[*].title"
          aria-label="JSONPath expression"
          spellCheck={false}
        />
        <span className="jsonpath-count">
          {count} result{count === 1 ? '' : 's'}
        </span>
      </div>

      {error ? (
        <div className="jsonpath-error">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      ) : (
        <div className="jsonpath-results">
          {count === 0 ? (
            <p className="empty-hint">No matches for this expression.</p>
          ) : (
            <JsonTree value={results} sortKeys={false} />
          )}
        </div>
      )}
    </div>
  );
}