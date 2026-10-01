import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { generatePayload } from '../generatePayload.js';
import { parseOpenApiSpec } from '../openApi.js';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Pet API', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } },
        },
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        },
      },
      get: {
        responses: { '200': { description: 'No body', content: { 'text/plain': { schema: { type: 'string' } } } } },
      },
    },
  },
  components: {
    schemas: {
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', example: 'Milo' }, tag: { type: 'string', nullable: true } },
      },
      Pet: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } },
      },
    },
  },
});

describe('parseOpenApiSpec', () => {
  test('lists JSON request/response schemas and resolves local component refs', async () => {
    const spec = await parseOpenApiSpec(OPENAPI_JSON);
    assert.equal(spec.title, 'Pet API');
    assert.equal(spec.operations.length, 1);
    assert.equal(spec.operations[0].label, 'POST /pets · createPet');
    assert.deepEqual(spec.operations[0].schemaOptions.map(({ label }) => label), [
      'Request · application/json',
      'Response 201 · application/json',
    ]);

    const requestSchema = spec.operations[0].schemaOptions[0].schema;
    assert.equal(requestSchema.$ref, '#/$defs/NewPet');
    assert.equal(requestSchema.$defs.NewPet.properties.name.examples[0], 'Milo');
    assert.deepEqual(requestSchema.$defs.NewPet.properties.tag.type, ['string', 'null']);
    const [generated] = await generatePayload(requestSchema, 1, { seed: 42 });
    assert.equal(typeof generated.name, 'string');
  });

  test('parses YAML OpenAPI documents', async () => {
    const parsed = await parseOpenApiSpec(`openapi: 3.0.3
info:
  title: Status API
  version: 1.0.0
paths:
  /status:
    get:
      responses:
        '200':
          description: Current status
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean`);
    assert.equal(parsed.title, 'Status API');
    assert.equal(parsed.operations[0].label, 'GET /status');
  });

  test('reports malformed, unsupported and reference-dependent specs clearly', async () => {
    await assert.rejects(() => parseOpenApiSpec('{'), /Could not parse/);
    await assert.rejects(() => parseOpenApiSpec('{"swagger":"2.0","paths":{}}'), /OpenAPI 3.x/);
    await assert.rejects(() => parseOpenApiSpec(JSON.stringify({
      openapi: '3.0.0',
      paths: { '/x': { post: { requestBody: { $ref: 'https://example.com/body' } } } },
    })), /External OpenAPI reference/);
  });
});