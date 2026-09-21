/**
 * parquet/parquetReader.js (part 1)
 * Browser-safe Parquet reader built on `hyparquet` (+ full codec support via
 * `hyparquet-compressors`, lazily imported so the JSON bundle stays lean).
 */

export const PARQUET_MAGIC = 'PAR1';

/** `true` when the bytes look like a Parquet file (head or head+tail magic). */
export function isParquetBytes(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head !== PARQUET_MAGIC) return false;
  if (bytes.length < 12) return true;
  const tail = String.fromCharCode(
    bytes[bytes.length - 4],
    bytes[bytes.length - 3],
    bytes[bytes.length - 2],
    bytes[bytes.length - 1],
  );
  return tail === PARQUET_MAGIC;
}

export function toAsyncBuffer(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    byteLength: buffer.byteLength,
    slice(start, end) {
      return buffer.slice(start, end);
    },
  };
}

export async function loadHyparquet() {
  const [core, codecs] = await Promise.all([
    import('hyparquet'),
    import('hyparquet-compressors').catch(() => null),
  ]);
  return { core, compressors: codecs?.compressors ?? undefined };
}

function bigToNumber(value) {
  if (typeof value === 'bigint') {
    const big = BigInt(value);
    if (big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(big);
    }
  }
  return value;
}

/** Flatten hyparquet's nested schema into `{ path, element }` leaf columns. */
export function flattenSchema(schema) {
  const columns = [];
  const walk = (node, path) => {
    const kids = node.children ?? [];
    if (kids.length === 0) {
      columns.push({ path, element: node.element ?? {} });
      return;
    }
    for (const kid of kids) {
      const name = kid.element?.name ?? 'field';
      walk(kid, [...path, name]);
    }
  };
  for (const child of schema?.children ?? []) {
    walk(child, [child.element?.name ?? 'field']);
  }
  return columns;
}

/** Human label for a parquet primitive + its logical annotation. */
export function describeParquetType(element = {}) {
  const base = element.type ?? element.converted_type ?? 'GROUP';
  const logical = element.logicalType?.type ?? element.logical_type?.type;
  const detail = [];
  if (logical && logical !== base) detail.push(logical);
  else if (element.converted_type && element.converted_type !== base) detail.push(element.converted_type);
  if (element.repetition_type) detail.push(String(element.repetition_type).toLowerCase());
  return detail.length > 0 ? `${base} (${detail.join(', ')})` : String(base);
}

function toSchemaNode(name, element, children) {
  return {
    name,
    type: element?.type ?? (children ? 'GROUP' : 'UNKNOWN'),
    detail: element?.repetition_type ? String(element.repetition_type).toLowerCase() : undefined,
    children,
  };
}

function schemaToTree(schema) {
  const convert = (node, fallback) => {
    const kids = (node.children ?? []).map((kid, i) => convert(kid, `field_${i}`));
    return toSchemaNode(node.element?.name ?? fallback, node.element, kids.length > 0 ? kids : undefined);
  };
  const roots = (schema?.children ?? []).map((kid, i) => convert(kid, `field_${i}`));
  return { name: schema?.element?.name ?? 'root', type: 'MESSAGE', children: roots };
}

/**
 * Read only the footer: schema, row count, row groups, compression codecs.
 * Throws a friendly `Error` when the bytes are not a Parquet file.
 */
export async function readParquetMetadata(bytes) {
  if (!isParquetBytes(bytes)) {
    throw new Error('Not a Parquet file: expected the "PAR1" magic bytes.');
  }
  const { core, compressors } = await loadHyparquet();
  const file = toAsyncBuffer(bytes);
  let metadata;
  try {
    metadata = await core.parquetMetadataAsync(file);
  } catch (cause) {
    throw new Error(`Could not read the Parquet footer: ${cause?.message ?? cause}`);
  }
  const schema = core.parquetSchema(metadata);
  const columns = flattenSchema(schema);
  const totalRows = Number(metadata.num_rows ?? 0n);
  const rowGroups = (metadata.row_groups ?? []).map((group, index) => ({
    index,
    rows: Number(group.num_rows ?? 0n),
    bytes: Number(group.total_byte_size ?? 0n),
    columns: group.columns?.length ?? 0,
    codecs: [...new Set((group.columns ?? []).map((c) => String(c.meta_data?.codec ?? 0)))],
  }));
  const codecs = [...new Set(rowGroups.flatMap((g) => g.codecs))];
  return {
    totalRows,
    columns: columns.map((col) => ({
      path: col.path,
      name: col.path.join('.'),
      label: describeParquetType(col.element),
      element: col.element,
    })),
    schemaTree: schemaToTree(schema),
    rowGroups,
    codecs,
    version: metadata.version,
    createdBy: metadata.created_by,
    keyValue: metadata.key_value_metadata ?? [],
    compressors,
  };
}

/**
 * Read a page of rows (`rowStart` inclusive, `rowEnd` exclusive).
 * `columns` optionally limits decoding to dotted paths like `["a.b"]`.
 */
export async function readParquetPreview(bytes, { rowStart = 0, rowEnd = 1000, columns } = {}) {
  const { core, compressors } = await loadHyparquet();
  const file = toAsyncBuffer(bytes);
  try {
    const rows = await core.parquetReadObjects({
      file,
      rowStart,
      rowEnd,
      columns,
      compressors,
    });
    return rows.map((row) => normalizeRow(row));
  } catch (cause) {
    throw new Error(`Could not decode Parquet rows ${rowStart}–${rowEnd}: ${cause?.message ?? cause}`);
  }
}

function normalizeRow(row) {
  if (row === null || typeof row !== 'object') return bigToNumber(row);
  if (Array.isArray(row)) return row.map(normalizeRow);
  if (row instanceof Date || row instanceof Uint8Array) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeRow(v);
  return out;
}
