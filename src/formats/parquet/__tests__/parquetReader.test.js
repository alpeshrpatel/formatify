import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parquetWriteBuffer } from 'hyparquet-writer';

import { flattenSchema, isParquetBytes, readParquetMetadata, readParquetPreview } from '../parquetReader.js';

function makeParquet({ codec = 'UNCOMPRESSED', extra = {} } = {}) {
  return new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'id', data: [1, 2, 3, 4] },
        { name: 'name', data: ['Ada', 'Bob', 'Cid', 'Dee'] },
        { name: 'score', data: [9.5, 7.25, 8.0, 6.5] },
        { name: 'active', data: [true, false, true, false] },
      ],
      codec,
      ...extra,
    }),
  );
}

describe('parquetReader — byte detection', () => {
  test('recognises head + tail magic', () => {
    const bytes = makeParquet();
    assert.equal(isParquetBytes(bytes), true);
  });

  test('rejects non-parquet bytes', () => {
    assert.equal(isParquetBytes(new Uint8Array([1, 2, 3, 4])), false);
    assert.equal(isParquetBytes(new TextEncoder().encode('{"a":1}')), false);
    assert.equal(isParquetBytes(new Uint8Array(0)), false);
  });
});

describe('parquetReader — metadata', () => {
  test('reads schema, row count and codecs from the footer', async () => {
    const meta = await readParquetMetadata(makeParquet());
    assert.equal(meta.totalRows, 4);
    assert.deepEqual(
      meta.columns.map((column) => column.name),
      ['id', 'name', 'score', 'active'],
    );
    assert.match(meta.columns[1].label, /UTF8/);
    assert.ok(meta.rowGroups.length >= 1);
    assert.ok(meta.schemaTree.children.length === 4);
  });

  test('rejects a file without the magic bytes', async () => {
    await assert.rejects(
      () => readParquetMetadata(new TextEncoder().encode('not parquet at all')),
      /PAR1/,
    );
  });
});

describe('parquetReader — preview rows', () => {
  test('decodes rows as plain objects', async () => {
    const bytes = makeParquet();
    const rows = await readParquetPreview(bytes, { rowStart: 0, rowEnd: 4 });
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0], { id: 1, name: 'Ada', score: 9.5, active: true });
    assert.deepEqual(rows[3], { id: 4, name: 'Dee', score: 6.5, active: false });
  });

  test('respects rowStart/rowEnd paging', async () => {
    const bytes = makeParquet();
    const rows = await readParquetPreview(bytes, { rowStart: 2, rowEnd: 3 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Cid');
  });
});

describe('parquetReader — schema helpers', () => {
  test('flattenSchema collects leaf columns', () => {
    const schema = {
      element: { name: 'root' },
      children: [
        { element: { name: 'a', type: 'INT32' } },
        {
          element: { name: 'g' },
          children: [{ element: { name: 'b', type: 'DOUBLE' } }],
        },
      ],
    };
    const columns = flattenSchema(schema);
    assert.deepEqual(
      columns.map((column) => column.path.join('.')),
      ['a', 'g.b'],
    );
  });
});
