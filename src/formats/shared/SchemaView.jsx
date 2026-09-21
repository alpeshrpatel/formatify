import { useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { truncateList } from './binaryUtils.js';

/**
 * Nested schema tree for Parquet / Avro schemas. `node` is a plain
 * `{ name, type, children?, detail? }` tree produced by the readers.
 */
export default function SchemaView({ node }) {
  if (!node) return <p className="empty-hint">No schema available.</p>;
  return (
    <div className="schema-tree">
      <SchemaNode node={node} depth={0} defaultOpen />
    </div>
  );
}

function SchemaNode({ node, depth, defaultOpen }) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? depth < 2);
  const kids = node.children ?? [];
  const leaf = kids.length === 0;
  return (
    <div className="tree-node">
      <div className="tree-row">
        {leaf ? (
          <span className="tree-toggle is-empty" />
        ) : (
          <button
            type="button"
            className="tree-toggle"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            title={isOpen ? 'Collapse' : 'Expand'}
          >
            <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
        )}
        <span className="tree-key">{node.name}</span>
        <span className="tree-colon">:</span>
        <span className="schema-type">{node.type}</span>
        {node.detail ? <span className="tree-count">{node.detail}</span> : null}
      </div>
      {!leaf && isOpen && (
        <div className="tree-children">
          {kids.map((k, i) => (
            <SchemaNode key={`${k.name}-${i}`} node={k} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Long lists (row groups, blocks) collapse to head + tail. */
export function CollapsedList({ items, render, limit = 6 }) {
  const { head, tail, omitted } = truncateList(items, limit);
  return (
    <ul className="meta-list">
      {head.map((item, i) => (
        <li key={i}>{render(item, i)}</li>
      ))}
      {omitted > 0 && <li className="tree-more">… {omitted} more</li>}
      {tail.map((item, i) => (
        <li key={head.length + omitted + i}>{render(item, head.length + omitted + i)}</li>
      ))}
    </ul>
  );
}
