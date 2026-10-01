import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { generatePayload } from '../jsonDataGenerator.js';
import { validateJsonSchema } from '../jsonSchemaValidate.js';

const API_SCHEMA = {
  type: 'object',
  required: ['id', 'name', 'email', 'status', 'orders'],
  properties: {
    id: { type: 'integer', minimum: 1000, maximum: 9999 },
    name: { type: 'string', faker: 'person.fullName' },
    email: { type: 'string', format: 'email' },
    status: { enum: ['active', 'pending', 'disabled'] },
    orders: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['sku', 'quantity'],
        properties: {
          sku: { type: 'string', faker: 'string.alphanumeric' },
          quantity: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  },
};

describe('generatePayload', () => {
  test('generates the requested number of valid nested API payloads', async () => {
    const records = await generatePayload(API_SCHEMA, 12, { seed: 42 });

    assert.equal(records.length, 12);
    for (const record of records) {
      assert.equal(validateJsonSchema(record, API_SCHEMA).valid, true);
      assert.match(record.name, /\S/);
      assert.match(record.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      assert.ok(record.id >= 1000 && record.id <= 9999);
      assert.ok(record.orders.length >= 1 && record.orders.length <= 2);
      assert.ok(record.orders.every((order) => order.quantity >= 1 && order.quantity <= 5));
    }
  });

  test('rejects counts outside the supported range', async () => {
    await assert.rejects(() => generatePayload(API_SCHEMA, 0), /between 1 and 500/);
    await assert.rejects(() => generatePayload(API_SCHEMA, 501), /between 1 and 500/);
  });

  test('requires a JSON Schema object', async () => {
    await assert.rejects(() => generatePayload([], 1), /schema must be a JSON Schema object/);
  });
});