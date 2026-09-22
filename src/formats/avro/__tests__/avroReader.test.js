import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import avsc from 'avsc';
import { compress as snappyCompress } from 'snappyjs';

import { crc32, snappyDecompress } from '../snappy.js';

describe('snappy — crc32', () => {
  test('matches node:zlib on a variety of inputs', () => {
    const samples = [
      new Uint8Array(0),
      new TextEncoder().encode('hello world'),
      new TextEncoder().encode('123456789'),
      crypto.getRandomValues(new Uint8Array(4096)),
      crypto.getRandomValues(new Uint8Array(1)),
    ];
    for (const bytes of samples) {
      assert.equal(crc32(bytes), zlibCrc32(Buffer.from(bytes)) >>> 0);
    }
  });
});

describe('snappy — decompression', () => {
  test('round-trips data compressed by the reference implementation', () => {
    const samples = [
      new TextEncoder().encode(''),
      new TextEncoder().encode('a'),
      new TextEncoder().encode('hello hello hello hello hello world'),
      new TextEncoder().encode('deadbeef'.repeat(100)),
      crypto.getRandomValues(new Uint8Array(300)), // incompressible → literals
      new TextEncoder().encode('x'.repeat(70_000)), // long runs + large literals
    ];
    for (const original of samples) {
      const compressed = snappyCompress(Buffer.from(original));
      const out = snappyDecompress(new Uint8Array(compressed));
      assert.deepEqual(out, original);
    }
  });

  test('reads small literals correctly (length 16–60 regression)', () => {
    // A literal of N bytes is tagged `((N - 1) << 2)`. For N in 16..60 the
    // raw tag is 64..236 — every one of these was once misparsed as "extra
    // length bytes follow", because the check compared the raw tag (>= 60)
    // instead of the shifted header value.
    for (const length of [15, 16, 17, 32, 59, 60, 61]) {
      const original = crypto.getRandomValues(new Uint8Array(length));
      const compressed = snappyCompress(Buffer.from(original));
      assert.deepEqual(
        snappyDecompress(new Uint8Array(compressed)),
        original,
        `literal length ${length}`,
      );
    }
  });

  test('reads 2- and 3-byte encoded literal lengths', () => {
    // 300 bytes → 2-byte length field; 70_000 → 3-byte length field.
    // (getRandomValues caps at 65,536 bytes, so big buffers are filled in chunks.)
    const randomBytes = (length) => {
      const out = new Uint8Array(length);
      for (let at = 0; at < length; at += 32_000) {
        out.set(crypto.getRandomValues(new Uint8Array(Math.min(32_000, length - at))), at);
      }
      return out;
    };
    for (const length of [300, 4096, 70_000]) {
      const original = randomBytes(length);
      const compressed = snappyCompress(Buffer.from(original));
      assert.deepEqual(
        snappyDecompress(new Uint8Array(compressed)),
        original,
        `literal length ${length}`,
      );
    }
  });

  test('handles offsets larger than 64 KiB (4-byte copy tags)', () => {
    // Two far-apart copies of the same 100-byte pattern force a big offset.
    const part = new TextEncoder().encode('PATTERN'.repeat(30));
    const original = new Uint8Array(part.length * 2 + 70_000);
    original.set(part, 0);
    original.set(part, 70_000);
    const compressed = snappyCompress(Buffer.from(original));
    assert.deepEqual(snappyDecompress(new Uint8Array(compressed)), original);
  });

  test('rejects a corrupt varint preamble', () => {
    // All continuation bits, no terminator.
    const bad = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    assert.throws(() => snappyDecompress(bad), /varint|Truncated/);
  });

  test('rejects a truncated stream', () => {
    const compressed = snappyCompress(Buffer.from('abcdef'.repeat(50)));
    const truncated = new Uint8Array(compressed.subarray(0, compressed.length - 4));
    assert.throws(() => snappyDecompress(truncated), /Truncated/);
  });

  test('rejects trailing garbage after the declared output', () => {
    const compressed = snappyCompress(Buffer.from('hi'));
    const withGarbage = new Uint8Array(compressed.length + 1);
    withGarbage.set(compressed);
    withGarbage[compressed.length] = 0;
    assert.throws(() => snappyDecompress(withGarbage), /trailing/);
  });
});

import {
  avroSchemaToTree,
  decodeSnappyBlock,
  isAvroBytes,
  readAvroHeader,
  readAvroPreview,
  scanAvroBlocks,
} from '../avroReader.js';

/** Encode records to an OCF buffer with the reference implementation. */
function encodeOcf(schema, records, opts = {}) {
  const type = avsc.Type.forSchema(schema);
  return new Promise((resolve, reject) => {
    const encoder = new avsc.streams.BlockEncoder(type, opts);
    const chunks = [];
    encoder.on('data', (chunk) => chunks.push(chunk));
    encoder.on('error', reject);
    encoder.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    for (const record of records) encoder.write(record);
    encoder.end();
  });
}

const USER_SCHEMA = {
  type: 'record',
  name: 'User',
  fields: [
    { name: 'id', type: 'long' },
    { name: 'name', type: 'string' },
    { name: 'score', type: 'double' },
    { name: 'active', type: 'boolean' },
    { name: 'tags', type: { type: 'array', items: 'string' } },
    { name: 'meta', type: ['null', { type: 'map', values: 'string' }], default: null },
    { name: 'color', type: { type: 'enum', name: 'Color', symbols: ['RED', 'GREEN', 'BLUE'] } },
    { name: 'avatar', type: { type: 'fixed', name: 'Md5', size: 16 } },
  ],
};

const USERS = [
  {
    id: 1,
    name: 'Ada',
    score: 9.5,
    active: true,
    tags: ['math', 'pioneer'],
    meta: { born: '1815' },
    color: 'GREEN',
    avatar: Buffer.alloc(16, 7),
  },
  {
    id: -42,
    name: 'Bob',
    score: 0.1,
    active: false,
    tags: [],
    meta: null,
    color: 'RED',
    avatar: Buffer.alloc(16, 9),
  },
];
describe('avroReader — byte detection', () => {
  test('recognises the Obj\\x01 magic', () => {
    assert.equal(isAvroBytes(new Uint8Array([0x4f, 0x62, 0x6a, 0x01])), true);
    assert.equal(isAvroBytes(new TextEncoder().encode('{"nope"}')), false);
    assert.equal(isAvroBytes(new Uint8Array(0)), false);
  });
});

describe('avroReader — header', () => {
  test('extracts schema, codec and sync marker', async () => {
    const bytes = await encodeOcf(USER_SCHEMA, USERS);
    const header = readAvroHeader(bytes);
    assert.equal(header.schema.name, 'User');
    assert.equal(header.codec, 'null');
    assert.equal(header.sync.length, 16);
    assert.ok(header.schemaText.includes('"User"'));
    assert.ok(header.registry.has('User'));
    assert.ok(header.registry.has('Color'));
  });

  test('rejects non-Avro bytes with a friendly error', () => {
    assert.throws(() => readAvroHeader(new TextEncoder().encode('hello')), /Obj/);
  });

  test('blocks are framed with matching sync markers', async () => {
    const bytes = await encodeOcf(USER_SCHEMA, USERS);
    const blocks = scanAvroBlocks(bytes);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].count, 2);
    assert.equal(blocks[0].synced, true);
  });
});
describe('avroReader — record decoding', () => {
  test('decodes records identical to the reference implementation', async () => {
    const bytes = await encodeOcf(USER_SCHEMA, USERS);
    const { records, totalCount, truncated } = await readAvroPreview(bytes);
    assert.equal(totalCount, 2);
    assert.equal(truncated, false);
    assert.equal(records[0].id, 1);
    assert.equal(records[0].name, 'Ada');
    assert.equal(records[0].color, 'GREEN');
    assert.deepEqual(records[0].tags, ['math', 'pioneer']);
    assert.deepEqual(records[0].meta, { born: '1815' });
    assert.ok(records[0].avatar instanceof Uint8Array);
    assert.equal(records[1].id, -42);
    assert.equal(records[1].meta, null);
    assert.equal(records[1].active, false);
  });

  test('decodes deflate-coded files', async () => {
    const bytes = await encodeOcf(USER_SCHEMA, USERS, { codec: 'deflate' });
    const { records, totalCount } = await readAvroPreview(bytes);
    assert.equal(totalCount, 2);
    assert.equal(records[0].name, 'Ada');
    assert.equal(records[1].name, 'Bob');
  });

  test('respects the record limit and flags truncation', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `user-${i}`,
      score: i,
      active: true,
      tags: [],
      meta: null,
      color: 'BLUE',
      avatar: Buffer.alloc(16, 1),
    }));
    const bytes = await encodeOcf(USER_SCHEMA, many);
    const { records, truncated } = await readAvroPreview(bytes, { limit: 10 });
    assert.equal(records.length, 10);
    assert.equal(records[9].name, 'user-9');
    assert.equal(truncated, true);
  });

  test('names an unsupported codec instead of failing cryptically', async () => {
    const schema = { type: 'record', name: 'R', fields: [{ name: 'x', type: 'int' }] };
    const meta = (key, value) => {
      const out = [];
      const writeLong = (n) => {
        let v = n >= 0 ? n * 2 : -n * 2 - 1;
        do {
          let byte = v & 0x7f;
          v >>>= 7;
          if (v) byte |= 0x80;
          out.push(byte);
        } while (v);
      };
      const writeStr = (s) => {
        writeLong(s.length);
        for (const ch of s) out.push(ch.charCodeAt(0));
      };
      writeStr(key);
      writeStr(value);
      return out;
    };
    const headerBytes = new Uint8Array([
      0x4f, 0x62, 0x6a, 0x01,
      0x04, // map block: 2 entries (zig-zag varint of 2 is 0x04)
      ...meta('avro.schema', JSON.stringify(schema)),
      ...meta('avro.codec', 'bzip2'),
      0x00, // end of map
      ...new Array(16).fill(0xab), // sync marker
    ]);
    const header = readAvroHeader(headerBytes);
    assert.equal(header.codec, 'bzip2');
    await assert.rejects(() => readAvroPreview(headerBytes), /bzip2/);
  });

  test('truncated files raise a byte-offset error', async () => {
    const bytes = await encodeOcf(USER_SCHEMA, USERS);
    const cut = bytes.subarray(0, bytes.length - 20);
    await assert.rejects(() => readAvroPreview(cut), /[Ss]ync|ends before/);
  });
});

describe('avroReader — schema tree', () => {
  test('renders a navigable tree', () => {
    const tree = avroSchemaToTree(USER_SCHEMA);
    assert.equal(tree.name, 'User');
    assert.match(tree.type, /record/);
    const fields = tree.children.map((child) => child.name);
    assert.deepEqual(fields, USER_SCHEMA.fields.map((f) => f.name));
    const union = tree.children.find((child) => child.name === 'meta');
    assert.equal(union.type, 'union');
    assert.ok(tree.children.find((child) => child.name === 'avatar').type.includes('fixed(16)'));
  });
});

/* ------------------------------------------------------------------------ */
/* snappy codec                                                              */
/* ------------------------------------------------------------------------ */

/** zig-zag varint bytes of a non-negative integer. */
function zigzagVarint(value) {
  const out = [];
  let v = value >= 0 ? value * 2 : -value * 2 - 1;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

/** Concatenate byte-like arrays. */
function concat(parts) {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Build an OCF with the `snappy` codec by hand.
 * `crcAttached` toggles the spec's 4-byte CRC trailer (Java/Spark writers
 * attach it; `avsc`-derived writers omit it) so both framings get coverage.
 */
function buildSnappyOcf(records, { crcAttached = true } = {}) {
  const type = avsc.Type.forSchema(USER_SCHEMA);
  const datum = concat(records.map((record) => type.toBuffer(record)));
  const compressed = snappyCompress(datum);
  const payload = crcAttached
    ? concat([
        compressed,
        [crc32(datum) >>> 24, (crc32(datum) >>> 16) & 0xff, (crc32(datum) >>> 8) & 0xff, crc32(datum) & 0xff],
      ])
    : compressed;
  return concat([
    [0x4f, 0x62, 0x6a, 0x01],
    [0x04],
    zigzagVarint('avro.schema'.length),
    [...'avro.schema'].map((ch) => ch.charCodeAt(0)),
    zigzagVarint(JSON.stringify(USER_SCHEMA).length),
    [...JSON.stringify(USER_SCHEMA)].map((ch) => ch.charCodeAt(0)),
    zigzagVarint('avro.codec'.length),
    [...'avro.codec'].map((ch) => ch.charCodeAt(0)),
    zigzagVarint('snappy'.length), // bytes values are zig-zag varint lengths, not raw bytes
    [...'snappy'].map((ch) => ch.charCodeAt(0)),
    [0x00],
    new Array(16).fill(0x5a),
    zigzagVarint(records.length),
    zigzagVarint(payload.length),
    payload,
    new Array(16).fill(0x5a),
  ]);
}

describe('avroReader — snappy block decoder', () => {
  test('decodes a spec-framed payload (CRC trailer present and matching)', () => {
    const original = new TextEncoder().encode('hello hello hello hello snappy');
    const compressed = snappyCompress(Buffer.from(original));
    const payload = concat([compressed, [(crc32(original) >>> 24) & 0xff, (crc32(original) >>> 16) & 0xff, (crc32(original) >>> 8) & 0xff, crc32(original) & 0xff]]);
    assert.deepEqual(decodeSnappyBlock(payload), original);
  });

  test('decodes a checksum-less payload (avsc-style writers)', () => {
    const original = new TextEncoder().encode('no crc trailer here at all');
    const payload = snappyCompress(Buffer.from(original));
    assert.deepEqual(decodeSnappyBlock(payload), original);
  });

  test('rejects a payload whose checksum does not match the data', () => {
    const original = new TextEncoder().encode('payload with a wrong checksum');
    const compressed = snappyCompress(Buffer.from(original));
    const payload = concat([compressed, [0xde, 0xad, 0xbe, 0xef]]);
    assert.throws(() => decodeSnappyBlock(payload), /checksum mismatch|Corrupt|Truncated/);
  });
});

describe('avroReader — snappy container files', () => {
  test('reads a spec-framed (CRC-attached) snappy file end to end', async () => {
    const bytes = buildSnappyOcf(USERS, { crcAttached: true });
    const header = readAvroHeader(bytes);
    assert.equal(header.codec, 'snappy');
    assert.equal(scanAvroBlocks(bytes).length, 1);
    const { records, totalCount, truncated } = await readAvroPreview(bytes);
    assert.equal(totalCount, 2);
    assert.equal(truncated, false);
    assert.equal(records[0].name, 'Ada');
    assert.equal(records[1].name, 'Bob');
    assert.deepEqual(records[0].tags, ['math', 'pioneer']);
  });

  test('reads a checksum-less snappy file (avsc-style framing)', async () => {
    const bytes = buildSnappyOcf(USERS, { crcAttached: false });
    const { records, totalCount } = await readAvroPreview(bytes);
    assert.equal(totalCount, 2);
    assert.equal(records[0].name, 'Ada');
    assert.equal(records[1].name, 'Bob');
  });

  test('reads many records across a snappy block', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      name: `user-${i}`,
      score: i * 0.5,
      active: i % 2 === 0,
      tags: [`t${i}`],
      meta: null,
      color: ['RED', 'GREEN', 'BLUE'][i % 3],
      avatar: Buffer.alloc(16, i % 251),
    }));
    const bytes = buildSnappyOcf(many, { crcAttached: true });
    const { records, totalCount, truncated } = await readAvroPreview(bytes);
    assert.equal(totalCount, 120);
    assert.equal(truncated, false);
    assert.equal(records[119].name, 'user-119');
    assert.equal(records[64].color, 'GREEN');
  });
});


