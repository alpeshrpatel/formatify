import { useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';

/** Containers with more children than this are rendered partially. */
const MAX_CHILDREN = 250;

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const isContainer = (value) => value !== null && typeof value === 'object';

function describe(value) {
  const type = typeOf(value);
  if (type === 'array') return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (type === 'object') {
    const size = Object.keys(value).length;
    return `${size} key${size === 1 ? '' : 's'}`;
  }
  return '';
}

function ScalarValue({ value, onCopy }) {
  const type = typeOf(value);
  const label =
    type === 'string' ? JSON.stringify(value) : type === 'null' ? 'null' : String(value);

  return (
    <button
      type="button"
      className={`tree-value is-${type}`}
      onClick={() => onCopy(label, type)}
      title="Click to copy this value"
    >
      {label}
    </button>
  );
}

function TreeNode({ label, value, depth, defaultOpen, onCopyValue, sortKeys, isRoot }) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  const container = isContainer(value);

  const entries = useMemo(() => {
    if (!container) return [];
    const list = Array.isArray(value)
      ? value.map((item, index) => [index, item])
      : Object.entries(value);
    if (Array.isArray(value) || !sortKeys) return list;
    return [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }, [container, value, sortKeys]);

  const shown = entries.slice(0, MAX_CHILDREN);

  return (
    <div className={isRoot ? 'tree-node is-root' : 'tree-node'}>
      <div className="tree-row">
        {container ? (
          <button
            type="button"
            className="tree-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            title={open ? 'Collapse' : 'Expand'}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
        ) : (
          <span className="tree-toggle is-empty" />
        )}

        {label !== undefined && label !== null && (
          <>
            <span className={isRoot ? 'tree-key is-root' : 'tree-key'}>{label}</span>
            <span className="tree-colon">:</span>
          </>
        )}

        {container ? (
          <button type="button" className="tree-summary" onClick={() => setOpen(!open)}>
            {Array.isArray(value) ? '[' : '{'}
            <span className="tree-count">{describe(value)}</span>
            {Array.isArray(value) ? ']' : '}'}
          </button>
        ) : (
          <ScalarValue value={value} onCopy={onCopyValue} />
        )}
      </div>

      {container && open && (
        <div className="tree-children">
          {shown.map(([key, child]) => (
            <TreeNode
              key={key}
              label={String(key)}
              value={child}
              depth={depth + 1}
              onCopyValue={onCopyValue}
              sortKeys={sortKeys}
            />
          ))}
          {entries.length > shown.length && (
            <p className="tree-more">
              … {entries.length - shown.length} more items hidden for performance
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsible explorer for a parsed JSON value. */
export default function JsonTree({ value, onCopyValue, sortKeys }) {
  if (!isContainer(value)) {
    return (
      <div className="tree-scroll">
        <ScalarValue value={value} onCopy={onCopyValue} />
      </div>
    );
  }
  return (
    <div className="tree-scroll">
      <TreeNode
        value={value}
        depth={0}
        defaultOpen
        onCopyValue={onCopyValue}
        sortKeys={sortKeys}
        isRoot
      />
    </div>
  );
}
