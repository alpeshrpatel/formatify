/** JsonConvert.js — convert a parsed JSON value between formats.

   Supports:
     - JSON → YAML   (using the `yaml` library already in devDependencies)
     - JSON → XML    (hand-written, recursive)
     - JSON → CSV    (hand-written, flat array-of-objects only)
     - YAML → JSON   (using `yaml`)
     - XML → JSON    (hand-written via DOMParser, browser only)
     - CSV → JSON    (hand-written, header row → object keys)

   All functions are pure and run in Node or the browser.
*/

/**
 * Convert a JavaScript value to a YAML string.
 * Uses the `yaml` package (peer dependency, available in dev/test).
 * Falls back to a minimal hand-rolled YAML for simple values when `yaml`
 * is not available (keeps the browser bundle lean if we ever tree-shake it).
 */
export async function toYaml(value) {
  try {
    const yaml = await import('yaml').catch(() => null);
    if (yaml?.stringify) {
      return yaml.stringify(value, { indent: 2, lineWidth: -1, quotingType: "'", forceQuotes: false });
    }
  } catch {
    // dynamic import failed — fall through to the hand-rolled path
  }
  return stringifyYamlManual(value);
}

/** Minimal YAML emitter for common JSON shapes. */
function stringifyYamlManual(value, indent = 0) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const escaped = value.replace(/'/g, "''");
    if (/[:\[\]{}|>&!%@`#\n\r]/.test(value) || value === '' || /^\d/.test(value)) {
      return "'" + escaped + "'";
    }
    return "'" + escaped + "'";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => stringifyYamlManual(item, indent + 1));
    const padMore = '  '.repeat(indent + 1);
    return items
      .map((line) =>
        line.includes('\n') ? '  '.repeat(indent) + '  ' + line.replace(/\n/g, '\n' + padMore) : '  '.repeat(indent) + '- ' + line
      )
      .join('\n');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const rows = keys.map((key) => {
      const val = stringifyYamlManual(value[key], indent + 1);
      const keyPart = /[:\[\]{}|>&!%@`#\s]/.test(key) ? "'" + key.replace(/'/g, "''") + "'" : key;
      if (val.includes('\n')) {
        return '  '.repeat(indent) + keyPart + ':\n' + '  '.repeat(indent + 1) + val.replace(/\n/g, '\n' + '  '.repeat(indent + 1));
      }
      return '  '.repeat(indent) + keyPart + ': ' + val;
    });
    return rows.join('\n');
  }
  return String(value);
}

/** Convert a JavaScript value to an XML string (recursive). */
export function toXml(value, elementName = 'root') {
  if (value === null || value === undefined) {
    return `<${elementName}></${elementName}>`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return `<${elementName}>${escapeXml(String(value))}</${elementName}>`;
  }
  if (typeof value === 'string') {
    return `<${elementName}>${escapeXml(value)}</${elementName}>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `<${elementName}></${elementName}>`;
    const name = elementName === 'root' ? 'item' : elementName;
    return value.map((item) => toXml(item, name)).join('');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `<${elementName}></${elementName}>`;
    const children = keys.map((key) => {
      const childValue = value[key];
      if (Array.isArray(childValue)) {
        if (childValue.length === 0) return '';
        return childValue.map((item) => toXml(item, key)).join('');
      }
      return toXml(childValue, key);
    });
    return `<${elementName}>${children.join('')}</${elementName}>`;
  }
  return `<${elementName}>${escapeXml(String(value))}</${elementName}>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Parse a CSV string into an array of objects. First row = headers. */
export function fromCsv(text) {
  if (!text.trim()) return [];
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvRow(line);
    const row = {};
    headers.forEach((key, i) => {
      const raw = cells[i] ?? '';
      if (raw === '') row[key] = null;
      else if (raw === 'true') row[key] = true;
      else if (raw === 'false') row[key] = false;
      else if (raw === 'null') row[key] = null;
      else {
        const num = Number(raw);
        row[key] = Number.isFinite(num) && String(num) === raw.trim() ? num : raw;
      }
    });
    return row;
  });
}

function splitCsvLines(text) {
  const lines = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      current += ch;
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      }
    } else if (ch === '"') {
      inQuote = true;
      current += ch;
    } else if (ch === '\n') {
      lines.push(current);
      current = '';
    } else if (ch === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') i += 1;
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCsvRow(row) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < row.length && row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Convert a flat array of objects to a CSV string. */
export function toCsv(value) {
  if (!Array.isArray(value) || value.length === 0) return '';
  const headerSet = new Set();
  const headers = [];
  for (const row of value) {
    for (const key of Object.keys(row)) {
      if (!headerSet.has(key)) {
        headerSet.add(key);
        headers.push(key);
      }
    }
  }
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of value) {
    lines.push(headers.map((key) => {
      const v = row[key];
      if (v === null || v === undefined) return '';
      return escapeCsvField(String(v));
    }).join(','));
  }
  return lines.join('\n');
}

function escapeCsvField(field) {
  if (/[",\n\r]/.test(field)) return '"' + field.replace(/"/g, '""') + '"';
  return field;
}

/** Parse a YAML string into a JavaScript value. Uses the `yaml` package. */
export async function fromYaml(text) {
  const yaml = await import('yaml').catch(() => null);
  if (!yaml) throw new Error('The YAML library is not available. YAML parsing requires the yaml package.');
  return yaml.parse(text);
}

/**
 * Parse an XML string into a JavaScript value using DOMParser (browser only).
 *
 * The root element is unwrapped: `<user>…</user>` maps to the value inside,
 * which mirrors the inverse of `toXml` for the common object case. Repeated
 * sibling tags are collected into an array, so `<row><tag>x</tag><tag>y</tag></row>`
 * becomes `{ tag: ['x', 'y'] }`.
 */
export function fromXml(text) {
  if (typeof DOMParser === 'undefined') throw new Error('XML parsing requires a browser environment (DOMParser).');
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid XML: ' + parseError.textContent.trim());
  const root = doc.documentElement;
  const childElements = [...root.childNodes].filter((n) => n.nodeType === 1);
  // A leaf root (e.g. `<a>1</a>`) maps to its scalar value.
  if (childElements.length === 0) return xmlNodeToValue(root);
  // Otherwise build an object from the root's children. Repeated sibling
  // tags become arrays, so `<row><tag>x</tag><tag>y</tag></row>` maps to
  // `{ tag: ['x', 'y'] }` — the inverse of `toXml` for the common shapes.
  return childTagValues(childElements);
}

/**
 * Unwrap a parsed DOM element — the recursive heart of `fromXml`.
 *
 * Rules:
 * - An element with no element children yields its coerced text (`true`,
 *   `false`, `null`, finite numbers, otherwise the raw string).
 * - Repeated sibling tags collect into an array under one key.
 * - Distinct child tags form an object keyed by tag name.
 */
function xmlNodeToValue(element) {
  const children = [...element.childNodes].filter((n) => n.nodeType === 1);
  if (children.length === 0) {
    const text = (element.childNodes[0]?.textContent ?? '').trim();
    if (text === '') return '';
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    const num = Number(text);
    if (Number.isFinite(num) && text !== '') return num;
    return text;
  }
  return childTagValues(children);
}

/**
 * Merge a list of sibling elements into an object keyed by tag name,
 * collecting repeated tags into an array.
 */
function childTagValues(children) {
  const obj = {};
  for (const child of children) {
    const value = xmlNodeToValue(child);
    const tag = child.tagName;
    if (Object.hasOwn(obj, tag)) {
      if (Array.isArray(obj[tag])) obj[tag].push(value);
      else obj[tag] = [obj[tag], value];
    } else {
      obj[tag] = value;
    }
  }
  return obj;
}