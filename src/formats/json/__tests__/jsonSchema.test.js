import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { inferSchema, validateJsonSchema } from '../jsonSchemaValidate.js';

const USER_SCHEMA = {
  type: 'object',
  required: ['name', 'age'],
  properties: {
    name: { type: 'string', minLength: 2 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    email: { type: 'string', format: 'email' },
  },
  additionalProperties: false,
};

/* -------------------------------------------------------------------------- */
/* type, enum, const                                                           */
/* -------------------------------------------------------------------------- */

describe('validateJsonSchema — type / enum / const', () => {
  test('accepts matching primitive types', () => {
    for (const [data, type] of [
      ['a', 'string'],
      [3, 'integer'],
      [3.5, 'number'],
      [true, 'boolean'],
      [null, 'null'],
      [[], 'array'],
      [{}, 'object'],
    ]) {
      assert.equal(validateJsonSchema(data, { type }).valid, true, `${data} as ${type}`);
    }
  });

  test('rejects mismatched types and reports the path', () => {
    const result = validateJsonSchema('x', { type: 'integer' });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, '$');
    assert.equal(result.errors[0].keyword, 'type');
  });

  test('treats integers as valid numbers but not the reverse', () => {
    assert.equal(validateJsonSchema(3, { type: 'number' }).valid, true);
    assert.equal(validateJsonSchema(3.5, { type: 'integer' }).valid, false);
  });

  test('checks enums', () => {
    assert.equal(validateJsonSchema('a', { enum: ['a', 'b'] }).valid, true);
    const failing = validateJsonSchema('c', { enum: ['a', 'b'] });
    assert.equal(failing.valid, false);
    assert.equal(failing.errors[0].keyword, 'enum');
  });

  test('checks const', () => {
    assert.equal(validateJsonSchema(1, { const: 1 }).valid, true);
    assert.equal(validateJsonSchema(2, { const: 1 }).valid, false);
  });

  test('an empty or non-object schema accepts anything', () => {
    assert.equal(validateJsonSchema('x', {}).valid, true);
    assert.equal(validateJsonSchema('x', true).valid, true);
  });
});


/* -------------------------------------------------------------------------- */
/* numbers and strings                                                         */
/* -------------------------------------------------------------------------- */

describe('validateJsonSchema — numbers and strings', () => {
  test('enforces minimum / maximum', () => {
    assert.equal(validateJsonSchema(5, { minimum: 1, maximum: 10 }).valid, true);
    const failing = validateJsonSchema(0, { minimum: 1 });
    assert.equal(failing.valid, false);
    assert.equal(failing.errors[0].keyword, 'minimum');
  });

  test('enforces exclusiveMinimum / exclusiveMaximum', () => {
    assert.equal(validateJsonSchema(5, { exclusiveMinimum: 5 }).valid, false);
    assert.equal(validateJsonSchema(5, { exclusiveMaximum: 5 }).valid, false);
    assert.equal(validateJsonSchema(6, { exclusiveMinimum: 5 }).valid, true);
  });

  test('enforces multipleOf', () => {
    assert.equal(validateJsonSchema(6, { multipleOf: 3 }).valid, true);
    assert.equal(validateJsonSchema(7, { multipleOf: 3 }).valid, false);
  });

  test('enforces minLength / maxLength', () => {
    assert.equal(validateJsonSchema('ab', { minLength: 2, maxLength: 2 }).valid, true);
    const failing = validateJsonSchema('abc', { maxLength: 2 });
    assert.equal(failing.valid, false);
    assert.equal(failing.errors[0].keyword, 'maxLength');
  });

  test('enforces pattern', () => {
    assert.equal(validateJsonSchema('2024-01-01', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }).valid, true);
    assert.equal(validateJsonSchema('nope', { pattern: '^\\d+$' }).valid, false);
  });

  test('enforces the email format', () => {
    assert.equal(validateJsonSchema('a@b.com', { format: 'email' }).valid, true);
    assert.equal(validateJsonSchema('nope', { format: 'email' }).valid, false);
  });
});

/* -------------------------------------------------------------------------- */
/* objects                                                                     */
/* -------------------------------------------------------------------------- */

describe('validateJsonSchema — objects', () => {
  test('validates a complete user document', () => {
    const result = validateJsonSchema(
      { name: 'Ada', age: 36, email: 'ada@example.com' },
      USER_SCHEMA,
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('reports missing required properties', () => {
    const result = validateJsonSchema({ name: 'Ada' }, USER_SCHEMA);
    assert.equal(result.valid, false);
    const problem = result.errors.find((entry) => entry.keyword === 'required');
    assert.ok(problem);
    assert.match(problem.path, /age/);
  });

  test('reports nested property errors with paths', () => {
    const result = validateJsonSchema({ name: 'A', age: -1 }, USER_SCHEMA);
    assert.equal(result.valid, false);
    const keywords = result.errors.map((entry) => entry.keyword);
    assert.ok(keywords.includes('minLength'));
    assert.ok(keywords.includes('minimum'));
  });

  test('rejects additional properties when forbidden', () => {
    const result = validateJsonSchema({ name: 'Ada', age: 3, nick: 'x' }, USER_SCHEMA);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.keyword === 'additionalProperties'));
  });

  test('checks minProperties / maxProperties', () => {
    assert.equal(validateJsonSchema({ a: 1 }, { minProperties: 2 }).valid, false);
    assert.equal(validateJsonSchema({ a: 1, b: 2 }, { maxProperties: 1 }).valid, false);
    assert.equal(validateJsonSchema({ a: 1 }, { minProperties: 1, maxProperties: 1 }).valid, true);
  });

  test('checks patternProperties', () => {
    const schema = { patternProperties: { '^x-': { type: 'string' } } };
    assert.equal(validateJsonSchema({ 'x-a': 'ok' }, schema).valid, true);
    assert.equal(validateJsonSchema({ 'x-a': 1 }, schema).valid, false);
  });

  test('validates extra values against an additionalProperties schema', () => {
    const schema = { properties: { a: { type: 'integer' } }, additionalProperties: { type: 'string' } };
    assert.equal(validateJsonSchema({ a: 1, b: 'ok' }, schema).valid, true);
    assert.equal(validateJsonSchema({ a: 1, b: 2 }, schema).valid, false);
  });
});

/* -------------------------------------------------------------------------- */
/* arrays                                                                      */
/* -------------------------------------------------------------------------- */

describe('validateJsonSchema — arrays', () => {
  test('validates items schemas', () => {
    assert.equal(validateJsonSchema([1, 2], { type: 'array', items: { type: 'integer' } }).valid, true);
    const failing = validateJsonSchema([1, 'x'], { type: 'array', items: { type: 'integer' } });
    assert.equal(failing.valid, false);
    assert.equal(failing.errors[0].path, '$[1]');
  });

  test('validates tuple-form items', () => {
    const schema = { type: 'array', items: [{ type: 'integer' }, { type: 'string' }] };
    assert.equal(validateJsonSchema([1, 'a'], schema).valid, true);
    assert.equal(validateJsonSchema(['a', 1], schema).valid, false);
  });

  test('enforces minItems / maxItems / uniqueItems', () => {
    assert.equal(validateJsonSchema([], { minItems: 1 }).valid, false);
    assert.equal(validateJsonSchema([1, 2], { maxItems: 1 }).valid, false);
    assert.equal(validateJsonSchema([1, 1], { uniqueItems: true }).valid, false);
    assert.equal(validateJsonSchema([1, 2], { uniqueItems: true }).valid, true);
  });
});


/* -------------------------------------------------------------------------- */
/* combinators, $ref, if/then/else                                             */
/* -------------------------------------------------------------------------- */

describe('validateJsonSchema — combinators and $ref', () => {
  test('allOf requires every branch', () => {
    const schema = { allOf: [{ type: 'string' }, { minLength: 5 }] };
    assert.equal(validateJsonSchema('ab', schema).valid, false);
    assert.equal(validateJsonSchema('abcdef', schema).valid, true);
  });

  test('anyOf requires at least one branch', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    assert.equal(validateJsonSchema(3, schema).valid, true);
    assert.equal(validateJsonSchema(true, schema).valid, false);
  });

  test('oneOf requires exactly one branch', () => {
    const both = { oneOf: [{ type: 'number' }, { minimum: 5 }] };
    assert.equal(validateJsonSchema(10, both).valid, false);
    const one = { oneOf: [{ type: 'integer' }, { type: 'string' }] };
    assert.equal(validateJsonSchema(3, one).valid, true);
    assert.equal(validateJsonSchema('x', one).valid, true);
    const none = { oneOf: [{ type: 'integer' }, { type: 'string' }] };
    assert.equal(validateJsonSchema(true, none).valid, false);
  });

  test('not rejects a matching schema', () => {
    assert.equal(validateJsonSchema('x', { not: { type: 'string' } }).valid, false);
    assert.equal(validateJsonSchema(1, { not: { type: 'string' } }).valid, true);
  });

  test('if / then / else branches correctly', () => {
    const schema = {
      if: { properties: { kind: { const: 'a' } } },
      then: { required: ['aField'] },
      else: { required: ['bField'] },
    };
    assert.equal(validateJsonSchema({ kind: 'a', aField: 1 }, schema).valid, true);
    assert.equal(validateJsonSchema({ kind: 'a' }, schema).valid, false);
    assert.equal(validateJsonSchema({ kind: 'b', bField: 1 }, schema).valid, true);
    assert.equal(validateJsonSchema({ kind: 'b' }, schema).valid, false);
  });

  test('resolves a local $ref through definitions', () => {
    const schema = {
      type: 'object',
      properties: { n: { $ref: '#/definitions/name' } },
      definitions: { name: { type: 'string' } },
    };
    assert.equal(validateJsonSchema({ n: 'x' }, schema).valid, true);
    assert.equal(validateJsonSchema({ n: 3 }, schema).valid, false);
  });

  test('reports an unresolvable $ref', () => {
    const result = validateJsonSchema('x', { $ref: '#/definitions/missing' });
    assert.equal(result.valid, false);
    assert.match(result.errors[0].message, /Unresolvable/);
  });
});

/* -------------------------------------------------------------------------- */
/* inferSchema                                                                 */
/* -------------------------------------------------------------------------- */

describe('inferSchema', () => {
  test('infers object properties and marks them all required', () => {
    assert.deepEqual(inferSchema({ a: 1, b: 'x', c: null, d: true, e: 1.5 }), {
      type: 'object',
      properties: {
        a: { type: 'integer' },
        b: { type: 'string' },
        c: { type: 'null' },
        d: { type: 'boolean' },
        e: { type: 'number' },
      },
      required: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  test('merges the properties of array items', () => {
    assert.deepEqual(inferSchema([{ a: 1 }, { a: 2, b: 'x' }]), {
      type: 'array',
      items: {
        type: 'object',
        properties: { a: { type: 'integer' }, b: { type: 'string' } },
        required: ['a'],
      },
    });
  });

  test('unions divergent item types', () => {
    assert.deepEqual(inferSchema([1, 'a']), {
      type: 'array',
      items: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
    });
  });

  test('widens integer + number to number', () => {
    assert.deepEqual(inferSchema([1, 2.5]), { type: 'array', items: { type: 'number' } });
  });

  test('handles an empty array and empty object', () => {
    assert.deepEqual(inferSchema([]), { type: 'array' });
    assert.deepEqual(inferSchema({}), { type: 'object', properties: {} });
  });

  test('an inferred schema accepts the document it was built from', () => {
    const document = { users: [{ name: 'Ada', age: 36 }, { name: 'Bo' }], total: 2 };
    const schema = inferSchema(document);
    assert.equal(validateJsonSchema(document, schema).valid, true);
  });
});
