import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fromCsv, fromXml, fromYaml, toCsv, toXml, toYaml } from '../jsonConvert.js';

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

describe('toCsv', () => {
  test('writes a header row then one row per record', () => {
    assert.equal(toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]), 'a,b\n1,x\n2,y');
  });

  test('returns an empty string for a non-array', () => {
    assert.equal(toCsv({ a: 1 }), '');
    assert.equal(toCsv(null), '');
  });

  test('returns an empty string for an empty array', () => {
    assert.equal(toCsv([]), '');
  });

  test('quotes fields containing a comma', () => {
    assert.equal(toCsv([{ a: 'x,y' }]), 'a\n"x,y"');
  });

  test('escapes embedded quotes by doubling them', () => {
    assert.equal(toCsv([{ a: 'q"z' }]), 'a\n"q""z"');
  });

  test('quotes fields containing a newline', () => {
    assert.equal(toCsv([{ a: 'x\ny' }]), 'a\n"x\ny"');
  });

  test('emits an empty cell for null and undefined', () => {
    assert.equal(toCsv([{ a: null, b: undefined }]), 'a,b\n,');
  });

  test('builds the union of keys across records in first-seen order', () => {
    assert.equal(toCsv([{ a: 1 }, { b: 2 }]), 'a,b\n1,\n,2');
  });

  test('stringifies booleans and numbers', () => {
    assert.equal(toCsv([{ a: true, b: 1.5 }]), 'a,b\ntrue,1.5');
  });
});

describe('fromCsv', () => {
  test('reads the first row as headers', () => {
    assert.deepEqual(fromCsv('a,b\n1,x\n2,y'), [
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
  });

  test('returns an empty array for blank input', () => {
    assert.deepEqual(fromCsv(''), []);
    assert.deepEqual(fromCsv('   '), []);
  });

  test('coerces numeric cells', () => {
    assert.deepEqual(fromCsv('n\n42\n3.5\n-7'), [{ n: 42 }, { n: 3.5 }, { n: -7 }]);
  });

  test('coerces true, false and null cells', () => {
    assert.deepEqual(fromCsv('a,b,c\ntrue,false,null'), [{ a: true, b: false, c: null }]);
  });

  test('reads empty cells as null', () => {
    assert.deepEqual(fromCsv('a,b\n,'), [{ a: null, b: null }]);
  });

  test('returns no rows when the file only has a header', () => {
    assert.deepEqual(fromCsv('a\n'), []);
  });

  test('keeps unquoted text that looks numeric but is not', () => {
    assert.deepEqual(fromCsv('a\n1.2.3'), [{ a: '1.2.3' }]);
  });

  test('unquotes fields containing a comma', () => {
    assert.deepEqual(fromCsv('a,b\n1,"x,y"'), [{ a: 1, b: 'x,y' }]);
  });

  test('unescapes doubled quotes', () => {
    assert.deepEqual(fromCsv('a\n"q""z"'), [{ a: 'q"z' }]);
  });

  test('keeps a newline inside a quoted field', () => {
    assert.deepEqual(fromCsv('a,b\n"x\ny",1'), [{ a: 'x\ny', b: 1 }]);
  });

  test('tolerates CRLF line endings', () => {
    assert.deepEqual(fromCsv('a,b\r\n1,x\r\n2,y'), [
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
  });

  test('round-trips through toCsv', () => {
    const rows = [
      { name: 'Ada, L.', note: 'said "hi"', n: 1 },
      { name: 'Grace', note: 'ok', n: 2 },
    ];
    assert.deepEqual(fromCsv(toCsv(rows)), rows);
  });
});

/* -------------------------------------------------------------------------- */
/* XML                                                                         */
/* -------------------------------------------------------------------------- */

describe('toXml', () => {
  test('wraps the document in a root element', () => {
    assert.equal(toXml({ a: 1 }), '<root><a>1</a></root>');
  });

  test('honours a custom root element name', () => {
    assert.equal(toXml({ a: 1 }, 'doc'), '<doc><a>1</a></doc>');
  });

  test('nests child objects', () => {
    assert.equal(
      toXml({ user: { name: 'Ada', role: 'eng' } }),
      '<root><user><name>Ada</name><role>eng</role></user></root>',
    );
  });

  test('repeats the key as the tag for each array element', () => {
    assert.equal(toXml({ tags: ['x', 'y'] }), '<root><tags>x</tags><tags>y</tags></root>');
  });

  test('names top-level array elements "item"', () => {
    assert.equal(toXml([1, 2]), '<item>1</item><item>2</item>');
  });

  test('renders an empty object as an empty element', () => {
    assert.equal(toXml({}), '<root></root>');
  });

  test('renders an empty array as nothing', () => {
    assert.equal(toXml({ a: [] }), '<root></root>');
  });

  test('escapes the XML metacharacters', () => {
    assert.equal(toXml({ a: 'x & <y> quote' }), '<root><a>x &amp; &lt;y&gt; quote</a></root>');
  });

  test('renders scalars, booleans and null', () => {
    assert.equal(toXml(5), '<root>5</root>');
    assert.equal(toXml(true), '<root>true</root>');
    assert.equal(toXml(null), '<root></root>');
    assert.equal(toXml({ a: null }), '<root><a></a></root>');
  });
});

describe('fromXml', () => {
  test('reports a clear error when no DOMParser exists', () => {
    const saved = globalThis.DOMParser;
    delete globalThis.DOMParser;
    try {
      assert.throws(() => fromXml('<a>1</a>'), /requires a browser environment/);
    } finally {
      globalThis.DOMParser = saved;
    }
  });

  test('parses a simple document through jsdom', async () => {
    const { JSDOM } = await import('jsdom');
    const saved = globalThis.DOMParser;
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
    try {
      assert.deepEqual(fromXml('<user><name>Ada</name></user>'), { name: 'Ada' });
    } finally {
      globalThis.DOMParser = saved;
    }
  });

  test('coerces XML text into JSON types', async () => {
    const { JSDOM } = await import('jsdom');
    const saved = globalThis.DOMParser;
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
    try {
      assert.deepEqual(fromXml('<row><n>42</n><ok>true</ok><none>null</none></row>'), {
        n: 42,
        ok: true,
        none: null,
      });
    } finally {
      globalThis.DOMParser = saved;
    }
  });

  test('collects repeated sibling tags into an array', async () => {
    const { JSDOM } = await import('jsdom');
    const saved = globalThis.DOMParser;
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
    try {
      assert.deepEqual(fromXml('<row><tag>x</tag><tag>y</tag></row>').tag, ['x', 'y']);
    } finally {
      globalThis.DOMParser = saved;
    }
  });

  test('rejects malformed XML', async () => {
    const { JSDOM } = await import('jsdom');
    const saved = globalThis.DOMParser;
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
    try {
      assert.throws(() => fromXml('<a><b></a>'), /Invalid XML/);
    } finally {
      globalThis.DOMParser = saved;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* YAML                                                                        */
/* -------------------------------------------------------------------------- */

describe('toYaml', () => {
  test('writes a mapping with two-space indentation', async () => {
    assert.equal(await toYaml({ a: 1, b: 2 }), 'a: 1\nb: 2\n');
  });

  test('writes sequences as block items', async () => {
    assert.equal(await toYaml({ b: ['x', 'y'] }), 'b:\n  - x\n  - y\n');
  });

  test('writes nested mappings', async () => {
    assert.equal(await toYaml({ c: { d: true } }), 'c:\n  d: true\n');
  });

  test('writes a top-level array', async () => {
    assert.equal(await toYaml([1, 2]), '- 1\n- 2\n');
  });

  test('writes scalars and null', async () => {
    assert.equal(await toYaml('hello'), 'hello\n');
    assert.equal(await toYaml(null), 'null\n');
    assert.equal(await toYaml(7), '7\n');
    assert.equal(await toYaml(false), 'false\n');
  });
});

describe('fromYaml', () => {
  test('parses a mapping', async () => {
    assert.deepEqual(await fromYaml('a: 1\nb: two\n'), { a: 1, b: 'two' });
  });

  test('parses nested sequences and maps', async () => {
    assert.deepEqual(await fromYaml('b:\n  - x\n  - y\nc:\n  d: true\n'), {
      b: ['x', 'y'],
      c: { d: true },
    });
  });

  test('parses a scalar document', async () => {
    assert.equal(await fromYaml('42'), 42);
  });

  test('round-trips a nested document', async () => {
    const source = { a: [1, { b: 2 }], c: 'text' };
    assert.deepEqual(await fromYaml(await toYaml(source)), source);
  });

  test('rejects malformed YAML with an error', async () => {
    await assert.rejects(() => fromYaml('a: [1, 2'), /./);
  });
});

