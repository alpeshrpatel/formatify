import { useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { compareCells, formatBytes, inferColumnType, stringifyCell } from './binaryUtils.js';

const PAGE_SIZES = [25, 50, 100, 250];

export function RowCountLabel({ shown, total }) {
  if (total == null) return null;
  if (shown >= total) {
    return (
      <span className="panel-hint">
        {total.toLocaleString()} row{total === 1 ? '' : 's'}
      </span>
    );
  }
  return (
    <span className="panel-hint">
      {shown.toLocaleString()} of {total.toLocaleString()} rows
    </span>
  );
}

export function FileMetaChips({ fileName, fileSize, extra = [] }) {
  return (
    <div className="location-row">
      <span className="loc-chip">
        <Icon name="file" size={13} />
        {fileName}
      </span>
      <span className="loc-chip">{formatBytes(fileSize)}</span>
      {extra.map((chip) => (
        <span className="loc-chip" key={chip}>
          {chip}
        </span>
      ))}
    </div>
  );
}
