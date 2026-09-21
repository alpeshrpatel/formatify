import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  JsonSyntaxError,
  describeChar,
  parseJson,
  summarizeNode,
  validateJson,
} from '../jsonParser.js';

const TAB = '\t';

/* -------------------------------------------------------------------------- */
/* valid documents                                                            */
/* -------------------------------------------------------------------------- */

const VALID_DOCUMENTS = [
  '{}',
  '[]',
  '0',
  '-0',
  '1e5',
  '1E+10',
  '-12.34e-2',
  'true',
  'false',
  'null',
  '"string"',
  '"\\u2764\\uFE0F"',
  '"/"',
  '"\\\\"',
  '"\\"quoted\\""',
  '{"a":{"b":[1,2,{"c":null}]}}',
  '\r\n\t {\n  "pretty" : 1\n}\r\n',
  '{"":1}',
  '[[],{},[null]]',
  '{"a":1e3,"b":-0.5,"c":1.0}',
  JSON.stringify({ nested: { deep: [1, 2, 3, { x: 'y' }] } }),
];

describe('parseJson — valid documents', () => {
  for (const document of VALID_DOCUMENTS) {
    test(`accepts ${JSON.stringify(document).slice(0, 48)}`, () => {
      const result = validateJson(document);
      assert.equal(result.ok, true, result.error && result.error.message);
      assert.deepEqual(result.value, JSON.parse(document));
      assert.equal(result.error, null);
      assert.ok(result.stats.total >= 1);
    });
  }

  test('keeps the raw text of every token so nothing is re-serialised', () => {
    const { node } = parseJson('{"n": 1e3, "s": "\\u2764"}');
    assert.equal(node.entries[0].value.raw, '1e3');
    assert.equal(node.entries[1].value.raw, '"\\u2764"');
  });

  test('materialises numbers, but warns about unsafe integers', () => {
    const result = validateJson('{"big": 12345678901234567890}');
    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'precision-loss');
    assert.equal(result.warnings[0].line, 1);
  });

  test('warns about duplicate keys and keeps the last value', () => {
    const result = validateJson('{\n  "a": 1,\n  "a": 2\n}');
    assert.equal(result.ok, true);
    assert.equal(result.value.a, 2);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'duplicate-key');
    assert.equal(result.warnings[0].line, 3);
    assert.match(result.warnings[0].message, /line 2, column 3/);
  });

  test('tolerates a UTF-8 BOM but reports it', () => {
    const result = validateJson('\uFEFF{"a":1}');
    assert.equal(result.ok, true);
    assert.equal(result.value.a, 1);
    assert.equal(result.warnings[0].code, 'bom');
  });

  test('a "__proto__" key does not touch the prototype', () => {
    const result = validateJson('{"__proto__": {"polluted": true}}');
    assert.equal(result.ok, true);
    assert.equal({}.polluted, undefined);
    assert.deepEqual(result.value.__proto__, { polluted: true });
  });

  test('does not blow up on 200 levels of nesting', () => {
    const deep = `${'['.repeat(200)}1${']'.repeat(200)}`;
    const result = validateJson(deep);
    assert.equal(result.ok, true);
    assert.equal(result.stats.maxDepth, 201);
  });

  test('a number too large for a double is still valid, but warns', () => {
    const result = validateJson('{"a": 1e999}');
    assert.equal(result.ok, true);
    assert.equal(result.warnings[0].code, 'number-out-of-range');
    assert.equal(result.value.a, Infinity);
  });

  test('capitalised literals are reported as a casing mistake', () => {
    const { error } = validateJson('{"a": True}');
    assert.equal(error.code, 'invalid-literal');
    assert.match(error.hint, /lowercase/);
    assert.match(error.message, /True/);
  });

  test('summarizeNode counts values by type', () => {
    const { node } = parseJson('{"a":1,"b":[true,null,"x"],"c":{}}');
    const stats = summarizeNode(node);
    assert.equal(stats.objects, 2);
    assert.equal(stats.arrays, 1);
    assert.equal(stats.numbers, 1);
    assert.equal(stats.booleans, 1);
    assert.equal(stats.nulls, 1);
    assert.equal(stats.strings, 1);
    assert.equal(stats.keys, 3);
    assert.equal(stats.maxDepth, 3);
  });
});

/* -------------------------------------------------------------------------- */
/* error reporting                                                            */
/* -------------------------------------------------------------------------- */

const ERROR_CASES = [
  { name: 'empty document', input: '', code: 'empty', line: 1, column: 1 },
  { name: 'whitespace only', input: '\n\t  \n', code: 'empty', line: 1, column: 1 },
  {
    name: 'trailing comma in an object',
    input: '{\n  "a": 1,\n}\n',
    code: 'trailing-comma',
    line: 3,
    column: 1,
    message: /Trailing comma before "}" is not allowed/,
  },
  { name: 'trailing comma in an array', input: '[1, 2, ]', code: 'trailing-comma', line: 1, column: 8 },
  {
    name: 'missing comma between properties',
    input: '{\n  "a": 1\n  "b": 2\n}\n',
    code: 'missing-comma',
    line: 3,
    column: 3,
  },
  { name: 'missing comma in an array', input: '[1 2]', code: 'missing-comma', line: 1, column: 4 },
  {
    name: 'semicolon instead of a comma',
    input: '{"a": 1;"b": 2}',
    code: 'missing-comma',
    line: 1,
    column: 8,
  },
  { name: 'unquoted key', input: '{\n  name: "Ada"\n}\n', code: 'unquoted-key', line: 2, column: 3 },
  { name: 'single quotes', input: '{\n  "a": \'x\'\n}\n', code: 'single-quote', line: 2, column: 8 },
  {
    name: 'curly quotes around a key',
    input: '{\u201Ca\u201D: 1}',
    code: 'smart-quote',
    line: 1,
    column: 2,
  },
  {
    name: 'curly quote closing a string',
    input: '{"a": "one\u201D}',
    code: 'smart-quote',
    line: 1,
    column: 11,
  },
  {
    name: 'bad Unicode escape',
    input: '{"emoji": "\\u12G4"}',
    code: 'bad-unicode-escape',
    line: 1,
    column: 12,
  },
  { name: 'javascript-only escape', input: '{"a": "\\x41"}', code: 'bad-escape', line: 1, column: 8 },
  {
    name: 'unterminated string',
    input: '{"a": "unterminated',
    code: 'unterminated-string',
    line: 1,
    column: 7,
  },
  { name: 'unterminated object', input: '{\n  "a": 1\n', code: 'unterminated-object', line: 1, column: 1 },
  { name: 'unterminated array', input: '[1, 2,', code: 'unterminated-array', line: 1, column: 1 },
  {
    name: 'unterminated array inside a property',
    input: '{\n  "items": [1,\n',
    code: 'unterminated-array',
    line: 2,
    column: 12,
  },
  {
    name: 'two documents',
    input: '{"a": 1}\n{"b": 2}\n',
    code: 'extra-content',
    line: 2,
    column: 1,
    message: /second JSON value/,
  },
  { name: 'trailing garbage', input: '{}extra', code: 'extra-content', line: 1, column: 3 },
  { name: 'two scalars', input: '42 43', code: 'extra-content', line: 1, column: 4 },
  { name: 'NaN', input: '{"a": NaN}', code: 'invalid-literal', line: 1, column: 7 },
  { name: 'Infinity', input: '{"a": Infinity}', code: 'invalid-literal', line: 1, column: 7 },
  { name: 'undefined', input: '{"a": undefined}', code: 'invalid-literal', line: 1, column: 7 },
  { name: 'wrong literal casing', input: '{"a": True}', code: 'invalid-literal', line: 1, column: 7 },
  { name: 'misspelled literal', input: '{"a": tru}', code: 'invalid-literal', line: 1, column: 7 },
  { name: 'leading zero', input: '{"a": 01}', code: 'leading-zero', line: 1, column: 7 },
  { name: 'plus sign', input: '{"a": +1}', code: 'plus-sign', line: 1, column: 7 },
  {
    name: 'leading decimal point',
    input: '{"a": .5}',
    code: 'leading-decimal-point',
    line: 1,
    column: 7,
  },
  { name: 'trailing decimal point', input: '{"a": 1.}', code: 'invalid-number', line: 1, column: 8 },
  { name: 'empty exponent', input: '{"a": 1e}', code: 'invalid-number', line: 1, column: 9 },
  { name: 'lone minus', input: '{"a": -}', code: 'invalid-number', line: 1, column: 7 },
  {
    name: 'line comment after a value',
    input: '{"a": 1 // note\n}\n',
    code: 'comment',
    line: 1,
    column: 9,
  },
  { name: 'block comment', input: '{/* hi */}', code: 'comment', line: 1, column: 2 },
  { name: 'line comment as a value', input: '{\n  "a": // note\n}', code: 'comment', line: 2, column: 8 },
  { name: 'mismatched brackets', input: '{"a": 1]', code: 'mismatched-bracket', line: 1, column: 8 },
  { name: 'mismatched brackets in an array', input: '[1}', code: 'mismatched-bracket', line: 1, column: 3 },
  { name: 'stray closing brace', input: '}', code: 'unmatched-bracket', line: 1, column: 1 },
  { name: 'stray comma', input: '[,]', code: 'unexpected-token', line: 1, column: 2 },
  { name: 'equals instead of a colon', input: '{"a" = 1}', code: 'missing-colon', line: 1, column: 6 },
  { name: 'missing colon', input: '{"a" 1}', code: 'missing-colon', line: 1, column: 6 },
  {
    name: 'unescaped newline in a string',
    input: '{\n  "a": "one\n  two"\n}\n',
    code: 'unescaped-newline',
    line: 2,
    column: 12,
  },
  {
    name: 'raw tab inside a string',
    input: `{"a": "${TAB}"}`,
    code: 'control-char',
    line: 1,
    column: 8,
  },
  { name: 'no-break space', input: '\u00A0{}', code: 'invalid-whitespace', line: 1, column: 1 },
  { name: 'xml input', input: '<root/>', code: 'wrong-format', line: 1, column: 1 },
  { name: 'bare word value', input: '{"a": hello}', code: 'unquoted-value', line: 1, column: 7 },
  { name: 'lone minus document', input: '-', code: 'unexpected-eof', line: 1, column: 1 },
];

describe('parseJson — error position, message and hint', () => {
  for (const testCase of ERROR_CASES) {
    test(`${testCase.name} → line ${testCase.line}, column ${testCase.column}`, () => {
      const result = validateJson(testCase.input);
      assert.equal(result.ok, false, `expected "${testCase.name}" to be invalid`);
      const { error } = result;
      assert.ok(error instanceof JsonSyntaxError);

      assert.equal(error.code, testCase.code, `message was: ${error.message}`);
      assert.equal(error.line, testCase.line);
      assert.equal(error.column, testCase.column);
      assert.equal(error.location, `Line ${testCase.line}, column ${testCase.column}`);
      assert.ok(error.hint.length > 10, 'every error must explain how to fix it');
      assert.ok(error.message.length > 10);
      if (testCase.message) assert.match(error.message, testCase.message);
    });
  }

  test('the code frame marks the failing line with ">" and a caret', () => {
    const { error } = validateJson('{\n  "a": 1,\n}\n');
    const lines = error.codeFrame.split('\n');
    const markerRow = lines.find((row) => row.startsWith('>'));
    assert.ok(markerRow.includes('3 |'));

    const caretRow = lines[lines.indexOf(markerRow) + 1];
    assert.match(caretRow, /\^/);
    assert.equal(caretRow.indexOf('^'), markerRow.indexOf('|') + 2);
  });

  test('the caret lines up with the reported column (tabs expanded)', () => {
    const { error } = validateJson('[\n\t1,\n\t2 3\n]');
    assert.equal(error.line, 3);
    const lines = error.codeFrame.split('\n');
    const markerRow = lines.find((row) => row.startsWith('>'));
    assert.ok(markerRow.includes('3 |'));
    const caretRow = lines[lines.indexOf(markerRow) + 1];
    assert.equal(caretRow.indexOf('^'), markerRow.indexOf('|') + 2 + (error.column - 1) + 3);
  });

  test('the snippet highlights the offending column', () => {
    const { error } = validateJson('{"a": 1,}');
    assert.ok(error.snippet);
    assert.equal(error.snippet.highlightStart, error.column - 1);
  });

  test('throws a JsonSyntaxError from parseJson()', () => {
    assert.throws(() => parseJson('{'), JsonSyntaxError);
    assert.throws(() => parseJson(null), TypeError);
  });

  test('the JSON Lines hint points at the array wrapper', () => {
    const { error } = validateJson('{"a":1}\n{"b":2}');
    assert.match(error.hint, /array/i);
  });

  test('describeChar renders the code point', () => {
    assert.equal(describeChar('a'), "'a' (U+0061)");
    assert.equal(describeChar('\t'), 'U+0009');
    assert.equal(describeChar(undefined), 'the end of input');
  });

  test('the error can be serialised (used by the CLI)', () => {
    const { error } = validateJson('{');
    const json = JSON.parse(JSON.stringify(error));
    assert.equal(json.code, 'unterminated-object');
    assert.equal(json.line, 1);
  });
});

/* -------------------------------------------------------------------------- */
/* the JSON.parse oracle                                                      */
/* -------------------------------------------------------------------------- */

describe('agreement with the native JSON.parse', () => {
  const documents = [
    ...VALID_DOCUMENTS,
    ...ERROR_CASES.map((testCase) => testCase.input),
    '{"a":1,}',
    '[1,,2]',
    '{"a":1,"a":2}',
    '[\n  "one",\n  "two"\n]',
    '{"unicode":"\\u00e9\\u2764"}',
    '{"escaped":"line\\nbreak"}',
    '1e999',
    '{"a": "\\uD834\\uDD1E"}',
  ];

  for (const document of documents) {
    test(`same verdict as JSON.parse for ${JSON.stringify(document).slice(0, 42)}`, () => {
      let nativeAccepted = true;
      try {
        JSON.parse(document);
      } catch {
        nativeAccepted = false;
      }
      const result = validateJson(document);
      assert.equal(result.ok, nativeAccepted, result.error && result.error.message);
      if (result.ok) assert.deepEqual(result.value, JSON.parse(document));
    });
  }

  test('accepts 200 randomly generated documents that JSON.parse accepts', () => {
    let state = 42;
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };

    const randomValue = (depth) => {
      const types = depth > 0
        ? ['string', 'number', 'boolean', 'null', 'array', 'object']
        : ['string', 'number', 'boolean', 'null'];
      switch (types[Math.floor(rand() * types.length)]) {
        case 'string':
          return `s${Math.floor(rand() * 100)}"\n\u00e9\\`;
        case 'number':
          return Number((rand() * 2000 - 1000).toFixed(3));
        case 'boolean':
          return rand() > 0.5;
        case 'null':
          return null;
        case 'array':
          return Array.from({ length: Math.floor(rand() * 4) }, () => randomValue(depth - 1));
        default: {
          const out = {};
          for (let i = 0; i < Math.floor(rand() * 4); i += 1) out[`k${i}`] = randomValue(depth - 1);
          return out;
        }
      }
    };

    for (let i = 0; i < 200; i += 1) {
      const value = randomValue(3);
      const document = JSON.stringify(value, null, rand() > 0.5 ? 2 : 0);
      const result = validateJson(document);
      assert.equal(result.ok, true, result.error && result.error.message);
      assert.deepEqual(result.value, JSON.parse(document));
    }
  });
});


