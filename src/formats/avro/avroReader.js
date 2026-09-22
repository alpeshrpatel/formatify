/**
 * avro/avroReader.js (part 1 — primitives)
 * ---------------------------------------------------------------------------
 * Dependency-free Avro Object Container File (OCF) reader for the browser.
 *
 * Why hand-written? The mature `avsc` package targets Node streams and pulls
 * in Node-isms that complicate the Vite browser bundle. The OCF framing plus
 * the binary datum encoding are compact enough to implement directly, and a
 * dev-only test suite cross-validates us against `avsc` output.
 *
 * Supported: every primitive, records, enums, arrays, maps, unions, fixed,
 * named-type references, `null`, `deflate` and `snappy` codecs, zig-zag
 * varints, block framing with sync markers, metadata (incl. `avro.schema`,
 * `avro.codec`).
 * Not supported: `bzip2` / `xz` / `zstandard` codecs (clear error naming the
 * codec), schema-resolution defaults (writer schema is authoritative).
 */

import { crc32, snappyDecompress } from './snappy.js';

export const AVRO_MAGIC = [0x4f, 0x62, 0x6a, 0x01]; // `Obj\x01`

/** `true` when the bytes start with Avro's `Obj\x01` magic. */
export function isAvroBytes(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return (
    bytes[0] === AVRO_MAGIC[0] &&
    bytes[1] === AVRO_MAGIC[1] &&
    bytes[2] === AVRO_MAGIC[2] &&
    bytes[3] === AVRO_MAGIC[3]
  );
}

export class AvroError extends Error {
  constructor(message, offset = null) {
    super(offset == null ? message : `${message} (byte ${offset})`);
    this.name = 'AvroError';
    this.offset = offset;
  }
}

class Cursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  get eof() {
    return this.pos >= this.bytes.length;
  }
  need(count, what, offset = this.pos) {
    if (this.pos + count > this.bytes.length) {
      throw new AvroError(`Truncated file: expected ${what}`, offset);
    }
  }
  u8() {
    this.need(1, '1 more byte');
    return this.bytes[this.pos++];
  }
  slice(count, what = `${count} bytes`) {
    this.need(count, what);
    const out = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }
  /** Unsigned LEB128 varint. */
  varint() {
    let shift = 0;
    let result = 0n;
    for (let i = 0; i < 10; i += 1) {
      const byte = this.u8();
      result |= BigInt(byte & 0x7f) << BigInt(shift);
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    throw new AvroError('Varint is too long (more than 10 bytes)', this.pos - 1);
  }
  /** Zig-zag long mapped back to a signed BigInt. */
  long() {
    const raw = this.varint();
    return (raw >> 1n) ^ -(raw & 1n);
  }
  float() {
    const raw = this.slice(4, 'a 4-byte float');
    return new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
  }
  double() {
    const raw = this.slice(8, 'an 8-byte double');
    return new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true);
  }
  utf8(byteCount) {
    const raw = this.slice(Number(byteCount), 'string bytes');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new AvroError('Invalid UTF-8 in a string or metadata value');
    }
  }
}

/**
 * Decode one snappy-codec block payload.
 *
 * Per the Avro OCF spec the snappy payload is the compressed stream followed
 * by a 4-byte big-endian CRC-32 of the *uncompressed* data. Some writers
 * (notably the `avsc` package) omit that checksum, so after a checksum
 * mismatch we retry the payload verbatim before giving up.
 */
export function decodeSnappyBlock(payload, blockIndex = 0) {
  if (payload.length === 0) {
    throw new AvroError(`Data block ${blockIndex} has an empty snappy payload.`, 0);
  }
  const compressed = payload.subarray(0, payload.length - 4);
  const storedCrc =
    ((payload[payload.length - 4] << 24) |
      (payload[payload.length - 3] << 16) |
      (payload[payload.length - 2] << 8) |
      payload[payload.length - 1]) >>>
    0;

  const attempts = [
    { data: compressed, expectedCrc: storedCrc, label: 'with checksum' },
    { data: payload, expectedCrc: null, label: 'without checksum' },
  ];
  let firstError = null;
  for (const attempt of attempts) {
    let uncompressed;
    try {
      uncompressed = snappyDecompress(attempt.data);
    } catch (cause) {
      firstError ??= cause;
      continue;
    }
    if (attempt.expectedCrc == null || crc32(uncompressed) === attempt.expectedCrc) {
      return uncompressed;
    }
    firstError ??= new Error(
      `checksum mismatch: stored 0x${attempt.expectedCrc.toString(16)}, computed ` +
        `0x${crc32(uncompressed).toString(16)} — the file is likely corrupt`,
    );
  }
  throw new AvroError(
    `Could not decompress the snappy payload of data block ${blockIndex}: ` +
      `${firstError?.message ?? firstError}`,
    0,
  );
}

/** Inflate raw-DEFLATE payloads (Avro's `deflate` codec is RFC 1951, not zlib). */
export async function inflateDeflate(payload) {
  const error = (cause) =>
    new AvroError(`Could not decompress a "deflate" block: ${cause?.message ?? cause}`);
  if (typeof DecompressionStream !== 'undefined') {
    // `deflate-raw` is part of the Compression Streams spec; older browsers
    // that only ship zlib-style 'deflate' fall back to Node's zlib below.
    for (const format of ['deflate-raw', 'deflate']) {
      try {
        const stream = new DecompressionStream(format);
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        const chunks = [];
        const pump = (async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        })();
        await writer.write(payload);
        await writer.close();
        await pump;
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.length;
        }
        return out;
      } catch (cause) {
        if (format === 'deflate-raw' && cause?.message?.includes('constructor')) continue;
        // Wrong header/format mismatch: fall through to the next strategy.
      }
    }
    throw error(new Error('no available inflate implementation'));
  }
  let zlib;
  try {
    // Node fallback (tests / runtimes without Compression Streams).
    ({ inflateRawSync: zlib } = await import('node:zlib'));
  } catch {
    throw error(new Error('this runtime supports neither DecompressionStream nor node:zlib'));
  }
  try {
    return new Uint8Array(zlib(Buffer.from(payload)));
  } catch (cause) {
    throw error(cause);
  }
}

/** Resolve named types so recursive / referenced schemas decode. */
export function collectNamedTypes(schema, registry = new Map()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return registry;
  if (schema.name) {
    const ns = schema.namespace ?? null;
    const full = schema.name.includes('.') ? schema.name : ns ? `${ns}.${schema.name}` : schema.name;
    if (!registry.has(full)) registry.set(full, schema);
    if (!registry.has(schema.name)) registry.set(schema.name, schema);
  }
  const kids =
    schema.type === 'record'
      ? (schema.fields ?? []).map((f) => f.type)
      : schema.type === 'array'
        ? [schema.items]
        : schema.type === 'map'
          ? [schema.values]
          : [];
  for (const kid of kids) {
    if (Array.isArray(kid)) kid.forEach((branch) => collectNamedTypes(resolveRef(branch, registry), registry));
    else collectNamedTypes(resolveRef(kid, registry), registry);
  }
  return registry;
}


/** Read one datum of `schema` from `cursor`. */
export function readDatum(cursor, schema, registry) {
  const node = resolveRef(schema, registry);
  if (Array.isArray(node)) return readUnion(cursor, node, registry);
  if (typeof node === 'string') return readPrimitive(cursor, node);
  if (!node || typeof node !== 'object') throw new AvroError('Invalid schema node', cursor.pos);
  switch (node.type) {
    case 'record':
      return readRecord(cursor, node, registry);
    case 'enum':
      return readEnum(cursor, node);
    case 'array':
      return readArray(cursor, node, registry);
    case 'map':
      return readMap(cursor, node, registry);
    case 'fixed':
      return readFixed(cursor, node);
    default:
      return readPrimitive(cursor, node.type, node);
  }
}

function readPrimitive(cursor, type, attrs = {}) {
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return cursor.u8() === 1;
    case 'int':
      return Number(cursor.long());
    case 'long': {
      const value = cursor.long();
      return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value;
    }
    case 'float':
      return cursor.float();
    case 'double':
      return cursor.double();
    case 'bytes': {
      const length = cursor.long();
      return cursor.slice(Number(length), 'bytes payload');
    }
    case 'string': {
      const length = cursor.long();
      return cursor.utf8(length);
    }
    default:
      break;
  }
  // Logical types keep their underlying encoding; annotate decimals/temporal values.
  if (attrs?.logicalType?.type === 'decimal') {
    const bytes = readPrimitive(cursor, attrs.type ?? 'bytes');
    return { decimal: bytesToHex(bytes), scale: attrs.logicalType.scale ?? 0 };
  }
  if (attrs?.logicalType?.type === 'date') return { date: Number(cursor.long()) };
  if (attrs?.logicalType?.type?.startsWith?.('timestamp')) return Number(cursor.long());
  if (attrs?.logicalType?.type === 'uuid') {
    const length = cursor.long();
    return cursor.utf8(length);
  }
  throw new AvroError(`Unsupported Avro type "${type}"`, cursor.pos);
}

function bytesToHex(bytes) {
  if (typeof bytes === 'string') return bytes;
  return Array.from(bytes ?? [], (b) => b.toString(16).padStart(2, '0')).join('');
}

function readUnion(cursor, branches, registry) {
  const start = cursor.pos;
  const index = cursor.long();
  if (index < 0n || index >= BigInt(branches.length)) {
    throw new AvroError(`Union index ${index} is out of range (0–${branches.length - 1})`, start);
  }
  return readDatum(cursor, branches[Number(index)], registry);
}

function readRecord(cursor, schema, registry) {
  const out = {};
  for (const field of schema.fields ?? []) {
    out[field.name] = readDatum(cursor, field.type, registry);
  }
  return out;
}

function readEnum(cursor, schema) {
  const index = Number(cursor.long());
  const symbols = schema.symbols ?? [];
  if (index < 0 || index >= symbols.length) {
    throw new AvroError(`Enum index ${index} is out of range`, cursor.pos);
  }
  return symbols[index];
}

function readArray(cursor, schema, registry) {
  const out = [];
  for (;;) {
    const count = cursor.long();
    if (count === 0n) break;
    if (count < 0n) {
      const byteSize = cursor.long();
      const end = cursor.pos + Number(byteSize);
      while (cursor.pos < end) out.push(readDatum(cursor, schema.items, registry));
      if (cursor.pos !== end) throw new AvroError('Array block overran its declared size', cursor.pos);
    } else {
      for (let i = 0; i < Number(count); i += 1) out.push(readDatum(cursor, schema.items, registry));
    }
  }
  return out;
}

function readMap(cursor, schema, registry) {
  const out = {};
  for (;;) {
    const count = cursor.long();
    if (count === 0n) break;
    const entries = count < 0n ? readSizedEntries(cursor, registry, schema) : Number(count);
    if (typeof entries === 'number') {
      for (let i = 0; i < entries; i += 1) {
        const key = cursor.utf8(cursor.long());
        out[key] = readDatum(cursor, schema.values, registry);
      }
    } else {
      Object.assign(out, entries);
    }
  }
  return out;
}

function readSizedEntries(cursor, registry, schema) {
  const byteSize = cursor.long();
  const end = cursor.pos + Number(byteSize);
  const out = {};
  while (cursor.pos < end) {
    const key = cursor.utf8(cursor.long());
    out[key] = readDatum(cursor, schema.values, registry);
  }
  if (cursor.pos !== end) throw new AvroError('Map block overran its declared size', cursor.pos);
  return out;
}

function readFixed(cursor, schema) {
  const size = schema.size ?? 0;
  const raw = cursor.slice(size, `fixed(${size}) payload`);
  if (schema.logicalType?.type === 'decimal') {
    return { decimal: bytesToHex(raw), scale: schema.logicalType.scale ?? 0 };
  }
  if (schema.logicalType?.type === 'duration') return { duration: bytesToHex(raw) };
  return raw;
}

/**
 * Parse the OCF header: magic, metadata map, sync marker.
 * Returns `{ meta, sync, headerLength, schema, codec, registry }`.
 */
export function readAvroHeader(bytes) {
  if (!isAvroBytes(bytes)) {
    throw new AvroError('Not an Avro container file: expected the "Obj\\x01" magic bytes.');
  }
  const cursor = new Cursor(bytes);
  cursor.pos = 4;
  const meta = {};
  const blockCount = cursor.long();
  const readMetaEntries = (count) => {
    for (let i = 0; i < count; i += 1) {
      const key = cursor.utf8(cursor.long());
      const length = cursor.long();
      meta[key] = cursor.slice(Number(length), `metadata value for "${key}"`);
    }
  };
  if (blockCount === 0n) {
    // empty map — nothing to do
  } else if (blockCount > 0n) {
    readMetaEntries(Number(blockCount));
    if (cursor.long() !== 0n) throw new AvroError('Malformed header metadata map', cursor.pos);
  } else {
    const byteSize = cursor.long();
    const end = cursor.pos + Number(byteSize);
    while (cursor.pos < end) {
      const key = cursor.utf8(cursor.long());
      const length = cursor.long();
      meta[key] = cursor.slice(Number(length), `metadata value for "${key}"`);
    }
    if (cursor.pos !== end) throw new AvroError('Header metadata overran its block size', cursor.pos);
    if (cursor.long() !== 0n) throw new AvroError('Malformed header metadata map', cursor.pos);
  }
  const sync = cursor.slice(16, 'the 16-byte sync marker');
  const headerLength = cursor.pos;

  const decodeMeta = (key) => {
    const raw = meta[key];
    if (!raw) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new AvroError(`Header key "${key}" is not valid UTF-8`, 4);
    }
  };
  const schemaText = decodeMeta('avro.schema');
  if (!schemaText) throw new AvroError('Header is missing the required "avro.schema" key.', 4);
  let schema;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    throw new AvroError('Header "avro.schema" is not valid JSON.', 4);
  }
  const codec = decodeMeta('avro.codec') ?? 'null';
  return {
    meta,
    metaText: Object.fromEntries(
      Object.entries(meta).map(([k, v]) => [k, k === 'avro.schema' ? schemaText : safeUtf8(v)]),
    ),
    sync,
    headerLength,
    schema,
    schemaText,
    codec,
    registry: collectNamedTypes(schema),
  };
}

function safeUtf8(raw) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return `(binary, ${raw.length} bytes)`;
  }
}

/** Walk data blocks without decoding: `{ index, offset, count, byteSize }`. */
export function scanAvroBlocks(bytes, header = readAvroHeader(bytes)) {
  const blocks = [];
  let pos = header.headerLength;
  let index = 0;
  while (pos < bytes.length) {
    const start = pos;
    const cursor = new Cursor(bytes);
    cursor.pos = pos;
    let count;
    let byteSize;
    try {
      count = cursor.long();
      byteSize = cursor.long();
    } catch {
      throw new AvroError(`Truncated data block header for block ${index}.`, pos);
    }
    const payloadStart = cursor.pos;
    const payloadEnd = payloadStart + Number(byteSize);
    if (payloadEnd + 16 > bytes.length) {
      throw new AvroError(`Data block ${index} claims ${byteSize} bytes but the file ends early.`, start);
    }
    const marker = bytes.subarray(payloadEnd, payloadEnd + 16);
    const synced = marker.every((b, i) => b === header.sync[i]);
    blocks.push({
      index,
      offset: start,
      count: count < 0 ? null : Number(count),
      countRaw: String(count),
      byteSize: Number(byteSize),
      payloadStart,
      payloadEnd,
      synced,
    });
    pos = payloadEnd + 16;
    index += 1;
  }
  return blocks;
}

/**
 * Decode at most `limit` records; returns `{ records, totalCount, truncated }`.
 * Codec support: `null` (raw), `deflate` (DecompressionStream) and `snappy`
 * (hand-written decoder in `./snappy.js`, with CRC verification).
 * Anything else throws an `AvroError` naming the codec.
 */
export async function readAvroPreview(bytes, { limit = 1000 } = {}) {
  const header = readAvroHeader(bytes);
  if (!['null', 'deflate', 'snappy'].includes(header.codec)) {
    throw new AvroError(
      `Unsupported Avro codec "${header.codec}". This reader supports "null", "deflate" and ` +
        `"snappy" — re-encode the file with one of those codecs to inspect it here.`,
    );
  }
  const records = [];
  let totalCount = 0;
  let truncated = false;
  let blockIndex = 0;
  let pos = header.headerLength;

  while (pos < bytes.length && !truncated) {
    const blockStart = pos;
    const cursor = new Cursor(bytes);
    cursor.pos = pos;
    let count;
    let byteSize;
    try {
      count = cursor.long();
      byteSize = cursor.long();
    } catch {
      throw new AvroError(`Truncated data block header for block ${blockIndex}.`, blockStart);
    }
    const payload = bytes.subarray(cursor.pos, cursor.pos + Number(byteSize));
    if (payload.length < Number(byteSize)) {
      throw new AvroError(`Data block ${blockIndex} ends before its ${byteSize} payload bytes.`, blockStart);
    }
    const marker = bytes.subarray(cursor.pos + Number(byteSize), cursor.pos + Number(byteSize) + 16);
    if (marker.length < 16) {
      throw new AvroError(`Data block ${blockIndex} is missing its 16-byte sync marker.`, blockStart);
    }
    if (!marker.every((b, i) => b === header.sync[i])) {
      throw new AvroError(`Data block ${blockIndex} has a sync-marker mismatch (wrong file spliced in?).`, blockStart);
    }
    pos = cursor.pos + Number(byteSize) + 16;

    const payloadBytes =
      header.codec === 'snappy'
        ? decodeSnappyBlock(payload, blockIndex)
        : header.codec === 'deflate'
          ? await inflateDeflate(payload)
          : payload;
    const data = new Cursor(payloadBytes);
    const remaining = () => limit - records.length;
    const take = count < 0n ? Number.MAX_SAFE_INTEGER : Number(count);
    for (let i = 0; i < take; i += 1) {
      if (data.eof) {
        if (count >= 0n) throw new AvroError(`Data block ${blockIndex} claims ${count} records but holds fewer.`, blockStart);
        break;
      }
      if (records.length >= limit) {
        truncated = true;
        break;
      }
      records.push(readDatum(data, header.schema, header.registry));
    }
    if (count < 0n) {
      // Negative counts are legal but opaque: drain to the declared byte size.
      while (data.pos < payloadBytes.length && records.length < limit) {
        records.push(readDatum(data, header.schema, header.registry));
      }
      if (records.length >= limit && data.pos < payloadBytes.length) truncated = true;
    }
    totalCount += count < 0n ? records.length - totalCount : Number(count);
    if (remaining() <= 0 && pos < bytes.length) truncated = true;
    blockIndex += 1;
  }

  return { header, records, totalCount, truncated, blockCount: blockIndex };
}

/** Avro schema → `{ name, type, children?, detail? }` tree for SchemaView. */
export function avroSchemaToTree(schema, name = 'root') {
  if (Array.isArray(schema)) {
    return {
      name,
      type: 'union',
      detail: `${schema.length} branches`,
      children: schema.map((branch, i) => avroSchemaToTree(branch, `branch_${i}`)),
    };
  }
  if (typeof schema === 'string') return { name, type: schema };
  if (!schema || typeof schema !== 'object') return { name, type: 'unknown' };
  const logical = schema.logicalType?.type ? ` (${schema.logicalType.type})` : '';
  switch (schema.type) {
    case 'record': {
      const fields = schema.fields ?? [];
      return {
        name: schema.name ?? name,
        type: `record${logical}`,
        detail: `${fields.length} field${fields.length === 1 ? '' : 's'}`,
        children: fields.map((f) => avroSchemaToTree(f.type, f.name)),
      };
    }
    case 'enum':
      return {
        name: name !== 'root' ? name : (schema.name ?? name),
        type: `enum${logical}`,
        detail: (schema.symbols ?? []).join(', ') || undefined,
      };
    case 'array':
      return {
        name,
        type: `array${logical}`,
        children: [avroSchemaToTree(schema.items, 'items')],
      };
    case 'map':
      return {
        name,
        type: `map${logical}`,
        children: [avroSchemaToTree(schema.values, 'values')],
      };
    case 'fixed':
      return {
        name: name !== 'root' ? name : (schema.name ?? name),
        type: `fixed(${schema.size ?? '?'})${logical}`,
      };
    default:
      return { name, type: `${schema.type ?? 'unknown'}${logical}` };
  }
}

function resolveRef(schema, registry) {
  if (typeof schema === 'string' && registry?.has(schema)) return registry.get(schema);
  return schema;
}
