/**
 * formats/index.js
 * ---------------------------------------------------------------------------
 * Every format Formatify understands registers itself here.
 *
 * Each entry is a small descriptor — the heavy code behind it
 * (e.g. the Parquet reader) is loaded lazily so the JSON experience
 * stays instant on first paint.
 *
 * A format module exposes:
 *   - `id`           stable key used for tabs, storage and file routing
 *   - `label`        short name shown in the format switcher
 *   - `description`  one line shown under the switcher
 *   - `icon`         name of an `Icon` glyph
 *   - `accept`       value for the `<input type="file" accept=…>` attribute
 *   - `extensions`   lowercase file extensions (with the leading dot)
 *   - `Panel`        React component rendered when the format is active
 *   - `loadPanel()`  lazy importer for code-split panels (optional)
 *   - `detect(bytes)`  `(Uint8Array) => number` confidence in [0, 1]
 */
export const FORMATS = [
  {
    id: 'json',
    label: 'JSON',
    description: 'Beautify, validate and repair JSON text.',
    icon: 'braces',
    accept: '.json,.jsonl,.ndjson,.txt,application/json,text/plain',
    extensions: ['.json', '.jsonl', '.ndjson', '.txt'],
    detect: (bytes) => detectJson(bytes),
    loadPanel: () => import('./json/JsonPanel.jsx'),
  },
  {
    id: 'parquet',
    label: 'Parquet',
    description: 'Inspect schemas and preview rows of .parquet files.',
    icon: 'table',
    accept: '.parquet,application/octet-stream',
    extensions: ['.parquet', '.pq', '.pqt'],
    detect: (bytes) => detectParquet(bytes),
    loadPanel: () => import('./parquet/ParquetPanel.jsx'),
  },
  {
    id: 'avro',
    label: 'Avro',
    description: 'Inspect schemas and preview rows of .avro container files.',
    icon: 'boxes',
    accept: '.avro,application/octet-stream',
    extensions: ['.avro'],
    detect: (bytes) => detectAvro(bytes),
    loadPanel: () => import('./avro/AvroPanel.jsx'),
  },
];

export const FORMAT_IDS = FORMATS.map((format) => format.id);

export function getFormat(id) {
  return FORMATS.find((format) => format.id === id) ?? FORMATS[0];
}

/**
 * Guess the format of an uploaded file.
 *
 * Extension wins over magic bytes (a `.json` file that happens to start
 * with `PAR1` is still JSON to us), otherwise the highest-confidence
 * magic-byte detector wins. Returns the format id — never null.
 */
export function detectFormat({ name = '', bytes = null } = {}) {
  const lower = String(name).toLowerCase();
  const byExtension = FORMATS.find((format) =>
    format.extensions.some((extension) => lower.endsWith(extension)),
  );
  if (byExtension) return byExtension.id;
  if (!bytes || bytes.length === 0) return 'json';

  let best = FORMATS[0];
  let bestScore = -1;
  for (const format of FORMATS) {
    let score = 0;
    try {
      score = format.detect(bytes);
    } catch {
      score = 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = format;
    }
  }
  return bestScore > 0 ? best.id : 'json';
}

function detectJson(bytes) {
  // JSON is text: a leading run of JSON whitespace / structural characters
  // is a strong signal; binary headers score zero elsewhere instead.
  const sample = bytes.subarray(0, 64);
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  } catch {
    return 0;
  }
  const trimmed = text.trimStart();
  if (!trimmed) return 0.1;
  const first = trimmed[0];
  if (first === '{' || first === '[') return 0.9;
  if (first === '"' || first === '-' || (first >= '0' && first <= '9')) return 0.7;
  if (/^(true|false|null)\b/.test(trimmed)) return 0.7;
  return 0;
}

function detectParquet(bytes) {
  // Parquet magic is `PAR1` at both the head and the tail of the file.
  if (bytes.length < 8) return 0;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head !== 'PAR1') return 0;
  const tail = String.fromCharCode(
    bytes[bytes.length - 4],
    bytes[bytes.length - 3],
    bytes[bytes.length - 2],
    bytes[bytes.length - 1],
  );
  return tail === 'PAR1' ? 1 : 0.6;
}

function detectAvro(bytes) {
  // Avro container files start with the three magic bytes `Obj\x01`.
  if (bytes.length < 4) return 0;
  return bytes[0] === 0x4f && bytes[1] === 0x62 && bytes[2] === 0x6a && bytes[3] === 0x01
    ? 1
    : 0;
}
