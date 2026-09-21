import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCells,
  formatBytes,
  inferColumnType,
  stringifyCell,
  toJsonSafe,
  truncateList,
} from '../binaryUtils.js';

describe('binaryUtils — formatBytes', () => {
  test('renders human sizes', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.05 KB');
    assert.equal(formatBytes(5_000_000), '5 MB');
    assert.equal(formatBytes(NaN), '—');
  });
});

describe('binaryUtils — stringifyCell', () => {
  test('covers primitives and exotics', () => {
    assert.equal(stringifyCell('hi'), 'hi');
    assert.equal(stringifyCell(12), '12');
    assert.equal(stringifyCell(9007199254740993n), '9007199254740993n');
    assert.equal(stringifyCell(null), '');
    assert.equal(stringifyCell(undefined), '');
    assert.equal(stringifyCell([1, 2]), '[1,2]');
    assert.equal(stringifyCell({ a: 1 }), '{"a":1}');
    assert.equal(stringifyCell(new Date('2024-01-02T00:00:00Z')), '2024-01-02T00:00:00.000Z');
  });

  test('previews byte arrays as hex', () => {
    const hex = stringifyCell(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    assert.equal(hex, '0xde ad be ef (4 bytes)');
  });
});

describe('binaryUtils — compareCells', () => {
  test('orders numbers, strings and nulls deterministically', () => {
    assert.ok(compareCells(1, 2) < 0);
    assert.ok(compareCells('a', 'b') < 0);
    assert.ok(compareCells(10, '9') !== 0);
    assert.ok(compareCells(null, 'x') > 0, 'nulls sink to the bottom');
    assert.ok(compareCells(undefined, undefined) === 0);
    assert.ok(compareCells(2n, 3n) < 0);
  });
});

describe('binaryUtils — inferColumnType', () => {
  test('reports the first non-null type', () => {
    const rows = [{ a: null }, { a: 5 }];
    assert.equal(inferColumnType(rows, 'a'), 'number');
    assert.equal(inferColumnType([{ b: [1] }], 'b'), 'array');
    assert.equal(inferColumnType([{ c: null }], 'c'), 'null');
  });
});

describe('binaryUtils — toJsonSafe', () => {
  test('converts BigInt, Dates and typed arrays', () => {
    const input = { n: 1n, at: new Date(0), bytes: new Uint8Array([1, 2, 255]) };
    const safe = toJsonSafe(input);
    assert.deepEqual(safe, { n: '1', at: '1970-01-01T00:00:00.000Z', bytes: 'AQL/' });
  });
});

describe('binaryUtils — truncateList', () => {
  test('keeps head + tail with an omitted count', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { head, tail, omitted } = truncateList(items, 6);
    assert.equal(head.length, 6);
    assert.equal(tail.length, 6);
    assert.equal(omitted, 8);
    assert.deepEqual([...head, ...tail].slice(0, 3), [0, 1, 2]);
  });

  test('leaves short lists untouched', () => {
    const { head, tail, omitted } = truncateList([1, 2, 3], 6);
    assert.deepEqual(head, [1, 2, 3]);
    assert.deepEqual(tail, []);
    assert.equal(omitted, 0);
  });
});
