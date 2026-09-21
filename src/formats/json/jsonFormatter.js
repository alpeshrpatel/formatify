/**
 * jsonFormatter.js
 * ---------------------------------------------------------------------------
 * Pretty printing and minifying built on top of `parseJson`.
 *
 * The printer walks the parser's raw AST instead of re-serialising plain JS
 * values, which means the original literals survive untouched:
 *
 *   - `1e3` stays `1e3` (JSON.stringify would turn it into 1000)
 *   - `0.30000000000000004` never becomes `0.3`
 *   - escapes such as `\u2764` or `\/` are preserved exactly as written
 */

import { parseJson } from './jsonParser.js';

/** `2`, `4` -> that many spaces; `'tab'` -> a real tab character. */
export function resolveIndentUnit(indent) {
  if (indent === 'tab' || indent === '\t') return '\t';
  const size = Number(indent);
  if (!Number.isFinite(size) || size <= 0) return '  ';
  return ' '.repeat(Math.min(size, 8));
}

/** Keys are compared byte by byte (deterministic, locale independent). */
function compareKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Serialises a parser AST node.
 * @param {object} node       node produced by `parseJson().node`
 * @param {object} [options]
 * @param {number|'tab'} [options.indent=2]
 * @param {boolean} [options.minify=false]
 * @param {boolean} [options.sortKeys=false]
 * @param {string} [options.eol='\n']
 */
export function stringifyNode(node, options = {}) {
  const { indent = 2, minify = false, sortKeys = false, eol = '\n' } = options;
  const unit = minify ? '' : resolveIndentUnit(indent);
  const gap = minify ? '' : ' ';
  const newline = minify ? '' : eol;

  const serialize = (current, level) => {
    const inner = unit.repeat(level + 1);
    const outer = unit.repeat(level);

    switch (current.type) {
      case 'object': {
        if (current.entries.length === 0) return '{}';
        const entries = sortKeys
          ? [...current.entries].sort((a, b) => compareKeys(a.key, b.key))
          : current.entries;
        const body = entries
          .map(
            (entry) =>
              `${inner}${JSON.stringify(entry.key)}:${gap}${serialize(entry.value, level + 1)}`,
          )
          .join(`,${newline}`);
        return `{${newline}${body}${newline}${outer}}`;
      }
      case 'array': {
        if (current.items.length === 0) return '[]';
        const body = current.items
          .map((item) => `${inner}${serialize(item, level + 1)}`)
          .join(`,${newline}`);
        return `[${newline}${body}${newline}${outer}]`;
      }
      case 'string':
        // keep the literal escape sequences the author wrote
        return current.raw;
      case 'number':
        return current.raw;
      case 'boolean':
        return current.value ? 'true' : 'false';
      case 'null':
        return 'null';
      default:
        throw new Error(`Cannot serialise unknown node type "${current.type}"`);
    }
  };

  return serialize(node, 0);
}

/**
 * Beautifies a JSON string.
 * @throws {import('./jsonParser.js').JsonSyntaxError} when the input is invalid.
 */
export function beautifyJson(text, options = {}) {
  const { node } = parseJson(text);
  const { indent = 2, sortKeys = false, eol = '\n' } = options;
  return stringifyNode(node, { indent, sortKeys, eol });
}

/**
 * Minifies a JSON string (no whitespace at all).
 * @throws {import('./jsonParser.js').JsonSyntaxError} when the input is invalid.
 */
export function minifyJson(text, options = {}) {
  const { node } = parseJson(text);
  return stringifyNode(node, { minify: true, sortKeys: options.sortKeys ?? false });
}

/** Byte length of a string encoded as UTF-8 (works in Node and the browser). */
export function utf8Size(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return Buffer.byteLength(text, 'utf8');
}

/** 1234 -> "1.21 KB" */
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

/** Counts lines the way an editor does (an empty string is 1 line). */
export function countLines(text) {
  if (!text) return 1;
  return text.split(/\r\n|\r|\n/).length;
}
