/** Generate a list of values from a user-provided JSON Schema. */
export async function generatePayload(schema, count, { seed = Date.now() + Math.floor(Math.random() * 1_000_000) } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new RangeError('Choose a record count between 1 and 500.');
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('The schema must be a JSON Schema object.');
  }

  const [{ createGenerator }, { faker }] = await Promise.all([
    import('json-schema-faker'),
    import('@faker-js/faker/locale/en'),
  ]);
  faker.seed(seed);
  const generator = createGenerator({ seed });
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push(await generator.generate(resolveFakerAnnotations(schema, faker), {
      alwaysFakeOptionals: true,
      optionalsProbability: 1,
      fillProperties: true,
      useDefaultValue: true,
      useExamplesValue: true,
    }));
  }
  return records;
}

function resolveFakerAnnotations(schema, faker) {
  if (Array.isArray(schema)) return schema.map((item) => resolveFakerAnnotations(item, faker));
  if (!schema || typeof schema !== 'object') return schema;

  const resolved = { ...schema };
  if (Object.hasOwn(resolved, 'faker')) {
    const fakerValue = resolveFakerValue(faker, resolved.faker);
    delete resolved.faker;
    if (!Object.hasOwn(resolved, 'const')) resolved.const = fakerValue;
  }

  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (resolved[key] && typeof resolved[key] === 'object') {
      resolved[key] = Object.fromEntries(
        Object.entries(resolved[key]).map(([name, child]) => [name, resolveFakerAnnotations(child, faker)]),
      );
    }
  }

  for (const key of ['items', 'additionalProperties', 'additionalItems', 'contains', 'propertyNames', 'contentSchema', 'not', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties']) {
    if (resolved[key] && typeof resolved[key] === 'object') {
      resolved[key] = resolveFakerAnnotations(resolved[key], faker);
    }
  }

  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(resolved[key])) {
      resolved[key] = resolved[key].map((child) => resolveFakerAnnotations(child, faker));
    }
  }
  return resolved;
}

function resolveFakerValue(faker, config) {
  const [path, args = []] = typeof config === 'string'
    ? [config, []]
    : Object.entries(config ?? {})[0] ?? [];
  if (typeof path !== 'string' || !Array.isArray(args)) {
    throw new TypeError('A faker annotation must be a method path or a method-to-arguments object.');
  }

  const parts = path.split('.');
  const methodName = parts.pop();
  let owner = faker;
  for (const part of parts) owner = owner?.[part];
  const method = owner?.[methodName];
  if (typeof method !== 'function') throw new Error(`Unknown Faker method "${path}".`);
  return method.apply(owner, args);
}