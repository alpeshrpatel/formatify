import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import avsc from 'avsc';

import {
  avroSchemaToTree,
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
      ...meta('avro.codec', 'snappy'),
      0x00, // end of map
      ...new Array(16).fill(0xab), // sync marker
    ]);
    const header = readAvroHeader(headerBytes);
    assert.equal(header.codec, 'snappy');
    await assert.rejects(() => readAvroPreview(headerBytes), /snappy/);
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

