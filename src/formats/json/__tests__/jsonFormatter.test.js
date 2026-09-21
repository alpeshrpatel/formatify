import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  beautifyJson,
  countLines,
  formatBytes,
  minifyJson,
  resolveIndentUnit,
  stringifyNode,
  utf8Size,
} from '../jsonFormatter.js';
import { parseJson, validateJson, JsonSyntaxError } from '../jsonParser.js';
import { repairJson } from '../jsonRepair.js';

/* -------------------------------------------------------------------------- */
/* formatter                                                                  */
/* -------------------------------------------------------------------------- */

describe('beautifyJson', () => {
  test('indents with two spaces by default', () => {
    assert.equal(beautifyJson('{"a":1,"b":[1,2]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  test('keeps empty containers on one line', () => {
    assert.equal(beautifyJson('{"a":{},"b":[]}'), '{\n  "a": {},\n  "b": []\n}');
  });

  test('honours other indent widths and tabs', () => {
    assert.equal(beautifyJson('{"a":1}', { indent: 4 }), '{\n    "a": 1\n}');
    assert.equal(beautifyJson('{"a":1}', { indent: 'tab' }), '{\n\t"a": 1\n}');
    assert.equal(resolveIndentUnit(0), '  ');
    assert.equal(resolveIndentUnit(20), ' '.repeat(8));
  });

  test('preserves the raw number and escape literals', () => {
    const input = '{"n":1e3,"m":0.30000000000000004,"e":"\\u2764","slash":"\\/"}';
    const pretty = beautifyJson(input);
    assert.match(pretty, /"n": 1e3/);
    assert.match(pretty, /"m": 0.30000000000000004/);
    assert.match(pretty, /"e": "\\u2764"/);
    assert.match(pretty, /"slash": "\\\/"/);
  });

  test('sorts keys when asked, recursively', () => {
    assert.equal(
      beautifyJson('{"b":1,"a":{"d":2,"c":3}}', { sortKeys: true }),
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}',
    );
  });

  test('can emit CRLF line endings', () => {
    assert.equal(beautifyJson('{"a":1}', { eol: '\r\n' }), '{\r\n  "a": 1\r\n}');
  });

  test('never changes the meaning of the document', () => {
    const input = '{"a":[1,2,{"b":"x\\n","c":true,"d":null}],"e":-1.5e-7,"f":""}';
    const pretty = beautifyJson(input, { indent: 4, sortKeys: true });
    assert.deepEqual(JSON.parse(pretty), JSON.parse(input));
    assert.deepEqual(JSON.parse(minifyJson(pretty)), JSON.parse(input));
  });

  test('throws a located JsonSyntaxError for invalid input', () => {
    assert.throws(() => beautifyJson('{"a":1,}'), JsonSyntaxError);
    assert.throws(() => minifyJson('[1,2'), JsonSyntaxError);
  });
});

describe('minifyJson', () => {
  test('removes every unnecessary space', () => {
    assert.equal(minifyJson('{ "a" : [ 1 , 2 ] , "b" : "x" }'), '{"a":[1,2],"b":"x"}');
    assert.equal(minifyJson('[\n  1,\n  2\n]\n'), '[1,2]');
  });

  test('keeps whitespace that lives inside strings', () => {
    assert.equal(minifyJson('{"a": "two  words"}'), '{"a":"two  words"}');
  });

  test('is smaller than the pretty version', () => {
    const pretty = beautifyJson('{"a":1,"b":[1,2,3],"c":{"d":null}}');
    assert.ok(minifyJson(pretty).length < pretty.length);
  });
});

describe('text helpers', () => {
  test('utf8Size counts bytes, not characters', () => {
    assert.equal(utf8Size('abc'), 3);
    assert.equal(utf8Size('é'), 2);
    assert.equal(utf8Size('❤'), 3);
  });

  test('formatBytes renders readable sizes', () => {
    assert.equal(formatBytes(12), '12 B');
    assert.equal(formatBytes(1234), '1.23 KB');
    assert.equal(formatBytes(1500000), '1.5 MB');
    assert.equal(formatBytes(Number.NaN), '—');
  });

  test('countLines counts editor lines', () => {
    assert.equal(countLines(''), 1);
    assert.equal(countLines('a'), 1);
    assert.equal(countLines('a\nb'), 2);
    assert.equal(countLines('a\r\nb\r\n'), 3);
  });

  test('stringifyNode rejects unknown node types', () => {
    assert.throws(() => stringifyNode({ type: 'wat' }), /unknown node type/);
    assert.equal(stringifyNode(parseJson('{"a":1}').node), '{\n  "a": 1\n}');
  });
});

/* -------------------------------------------------------------------------- */
/* auto repair                                                                */
/* -------------------------------------------------------------------------- */

describe('repairJson', () => {
  const expectRepaired = (input, expectations = {}) => {
    const result = repairJson(input);
    assert.equal(result.changed, true, 'expected the document to be changed');
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.ok(result.notes.length > 0, 'every change must be reported');
    if (expectations.value) assert.deepEqual(result.result.value, expectations.value);
    return result;
  };

  test('leaves a valid document untouched', () => {
    const input = '{"a": 1}';
    const result = repairJson(input);
    assert.equal(result.changed, false);
    assert.equal(result.text, input);
    assert.deepEqual(result.notes, []);
  });

  test('removes trailing commas', () => {
    expectRepaired('{"a": 1, "b": [1, 2,],}', { value: { a: 1, b: [1, 2] } });
  });

  test('removes comments but keeps "//" inside strings', () => {
    const result = repairJson(
      '{\n  // a note\n  "url": "https://example.com//path", /* inline */\n  "a": 1\n}',
    );
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.equal(result.result.value.url, 'https://example.com//path');
  });

  test('converts single quotes and curly quotes', () => {
    const result = repairJson('{\u201Cname\u201D: \'Ada\'}');
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.deepEqual(result.result.value, { name: 'Ada' });
  });

  test('quotes bare object keys', () => {
    expectRepaired('{\n  name: "Ada",\n  age: 36\n}', { value: { name: 'Ada', age: 36 } });
  });

  test('replaces NaN, Infinity and undefined with null', () => {
    expectRepaired('{"a": NaN, "b": Infinity, "c": undefined, "d": -Infinity}', {
      value: { a: null, b: null, c: null, d: null },
    });
  });

  test('inserts the missing comma the parser asked for', () => {
    expectRepaired('{\n  "a": 1\n  "b": 2\n}', { value: { a: 1, b: 2 } });
  });

  test('inserts missing commas in arrays', () => {
    expectRepaired('[1 2 3]', { value: [1, 2, 3] });
  });

  test('turns semicolons into commas', () => {
    expectRepaired('{"a": 1; "b": 2}', { value: { a: 1, b: 2 } });
  });

  test('closes an unterminated object', () => {
    expectRepaired('{\n  "a": 1\n', { value: { a: 1 } });
  });

  test('closes an unterminated array', () => {
    expectRepaired('[1, 2, {"a": 3}', { value: [1, 2, { a: 3 }] });
  });

  test('escapes raw tabs inside strings', () => {
    const result = repairJson('{"a": "one\ttwo"}');
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.equal(result.result.value.a, 'one\ttwo');
  });

  test('drops a stray closing bracket', () => {
    expectRepaired('{"a": 1]}', { value: { a: 1 } });
  });

  test('repairs a fully hand-written pseudo JSON document', () => {
    const messy = [
      '{',
      '  // customer record',
      '  id: 42,',
      '  name: \u2018Ada Lovelace\u2019,',
      '  active: True,',
      '  score: NaN,',
      '  tags: ["maths", "engine",],',
      '}',
    ].join('\n');

    const result = repairJson(messy);
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.deepEqual(result.result.value, {
      id: 42,
      name: 'Ada Lovelace',
      active: true,
      score: null,
      tags: ['maths', 'engine'],
    });
    assert.ok(result.notes.length >= 3);
  });

  test('keeps an apostrophe inside a string an apostrophe', () => {
    const result = repairJson('{\u201Cnote\u201D: \u201Cdon\u2019t panic\u201D}');
    assert.equal(result.result.ok, true, result.result.error && result.result.error.message);
    assert.deepEqual(result.result.value, { note: "don't panic" });
  });

  test('gives up gracefully when it cannot fix the document', () => {
    const result = repairJson('<root/>');
    assert.equal(result.changed, false);
    assert.equal(result.result.ok, false);
  });

  test('never loops forever', () => {
    const result = repairJson(`[${'1 2 '.repeat(80)}]`, { maxPasses: 5 });
    assert.ok(result.notes.length <= 6);
  });
});

/* -------------------------------------------------------------------------- */
/* validate -> format pipeline                                                */
/* -------------------------------------------------------------------------- */

describe('validate -> format pipeline', () => {
  test('formats only after the document validates', () => {
    const broken = '{"a": 1,}';
    assert.equal(validateJson(broken).ok, false);
    const fixed = repairJson(broken);
    assert.equal(fixed.result.ok, true);
    assert.equal(beautifyJson(fixed.text), '{\n  "a": 1\n}');
  });
});

