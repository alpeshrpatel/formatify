/**
 * shared/binaryUtils.js
 * ---------------------------------------------------------------------------
 * Small helpers shared by the binary format readers (Parquet, Avro).
 * Everything in here is dependency free and safe to run in the browser.
 */

/** A `File`/`Blob` as raw bytes. */
export function readFileBytes(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsArrayBuffer(file);
  });
}

/** `PAR1…` → `"PAR1…"`, control bytes rendered as escapes. */
export function magicToString(bytes, length = 4) {
  return Array.from(bytes.subarray(0, length), (byte) =>
    byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`,
  ).join('');
}

/** 1234 → `"1.23 KB"` */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const rounded = value < 10 ? value.toFixed(2) : value.toFixed(1);
  return `${Number(rounded)} ${units[unitIndex]}`;
}

/**
 * Totally-ordered comparison used to sort record tables by a column.
 * Numbers sort numerically, everything else by string value;
 * `null`/`undefined` always sink to the bottom.
 */
export function compareCells(a, b) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  const left = stringifyCell(a);
  const right = stringifyCell(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Best-effort rendering of one cell value. BigInts, Dates and nested
 * arrays/objects never reach the DOM raw — everything becomes a string.
 */
export function stringifyCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof Uint8Array) {
    const preview = Array.from(value.subarray(0, 16), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(' ');
    return `0x${preview}${value.length > 16 ? ` … (${value.length} bytes)` : ` (${value.length} bytes)`}`;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_, nested) =>
        typeof nested === 'bigint' ? `${nested.toString()}n` : nested,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Short type label for a column — shown in the table header. */
export function inferColumnType(rows, key) {
  for (const row of rows) {
    const value = row?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'bigint') return 'bigint';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Uint8Array) return 'bytes';
    if (value instanceof Date) return 'timestamp';
    return typeof value;
  }
  return 'null';
}

/**
 * Convert rows that may contain BigInts / Dates / Uint8Arrays into plain
 * JSON-safe values so they can be downloaded as `.json`.
 */
export function toJsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < value.length; i += 1) binary += String.fromCharCode(value[i]);
    try {
      return btoa(binary);
    } catch {
      return Array.from(value);
    }
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) out[key] = toJsonSafe(nested);
    return out;
  }
  return value;
}

/** Trigger a download of `content` (string or Blob parts). */
export function downloadFile(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** First `limit` + last `limit` items with an omission count. */
export function truncateList(items, limit = 12) {
  if (items.length <= limit * 2) return { head: items, tail: [], omitted: 0 };
  return {
    head: items.slice(0, limit),
    tail: items.slice(-limit),
    omitted: items.length - limit * 2,
  };
}
