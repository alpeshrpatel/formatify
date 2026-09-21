import { useMemo, useState } from 'react';

import Icon from '../../components/Icon.jsx';
import { compareCells, inferColumnType, stringifyCell } from './binaryUtils.js';

const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Paginated, sortable, filterable records table.
 * Rendering is capped with pagination (binary files can hold millions of
 * rows); columns come from the union of keys; every header sorts.
 */
export default function RecordsTable({ rows, totalRows = null, truncated = false }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const columns = useMemo(() => {
    const keys = [];
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
      if (keys.length >= 64) break;
    }
    return keys;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = rows;
    if (needle) {
      list = rows.filter((row) => {
        if (row === null || row === undefined) return false;
        if (typeof row !== 'object') return stringifyCell(row).toLowerCase().includes(needle);
        return Object.values(row).some((v) => stringifyCell(v).toLowerCase().includes(needle));
      });
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const l = a && typeof a === 'object' ? a[sortKey] : a;
        const r = b && typeof b === 'object' ? b[sortKey] : b;
        return compareCells(l, r) * sortDir;
      });
    }
    return list;
  }, [rows, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const toggleSort = (key) => {
    setPage(0);
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(1);
    } else if (sortDir === 1) {
      setSortDir(-1);
    } else {
      setSortKey(null);
      setSortDir(1);
    }
  };

  if (!rows || rows.length === 0) return <p className="empty-hint">No rows to show.</p>;
  const footNote = `Page ${safePage + 1} of ${pageCount} · ${filtered.length} matches`;

  return (
    <div className="records">
      <div className="records-toolbar">
        <label className="records-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter rows…"
            aria-label="Filter rows"
          />
        </label>
        <label className="select-wrap" title="Rows shown per page">
          <span className="select-label">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table className="records-table">
          <thead>
            <tr>
              <th className="row-index" scope="col">#</th>
              {columns.map((col) => (
                <th key={col} scope="col">
                  <button
                    type="button"
                    className={sortKey === col ? 'th-sort is-active' : 'th-sort'}
                    onClick={() => toggleSort(col)}
                    title={`Sort by ${col} (${inferColumnType(rows, col)})`}
                  >
                    {col}
                    <span className="th-type">{inferColumnType(rows, col)}</span>
                    <span className="th-arrow">{sortKey === col ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <RecordRow key={start + i} row={row} columns={columns} number={start + i + 1} />
            ))}
          </tbody>
        </table>
        {pageRows.length === 0 && <p className="empty-hint">No rows match the filter.</p>}
      </div>
      <div className="records-footer">
        <span className="panel-hint">
          {footNote}
          {truncated && totalRows != null && totalRows > rows.length
            ? ` · preview of ${totalRows.toLocaleString()} total`
            : ''}
        </span>
        <div className="pager">
          <button type="button" className="mini-btn" disabled={safePage === 0} onClick={() => setPage(0)}>
            « First
          </button>
          <button type="button" className="mini-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ‹ Prev
          </button>
          <button type="button" className="mini-btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            Next ›
          </button>
          <button type="button" className="mini-btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>
            Last »
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordRow({ row, columns, number }) {
  if (row === null || typeof row !== 'object') {
    return (
      <tr>
        <td className="row-index">{number}</td>
        <td colSpan={Math.max(columns.length, 1)}>
          <code className="cell-text">{stringifyCell(row)}</code>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="row-index">{number}</td>
      {columns.map((col) => {
        const v = row[col];
        const missing = v === null || v === undefined;
        return (
          <td key={col} className={missing ? 'is-null' : ''}>
            <code className="cell-text" title={stringifyCell(v)}>
              {missing ? '∅' : stringifyCell(v)}
            </code>
          </td>
        );
      })}
    </tr>
  );
}

