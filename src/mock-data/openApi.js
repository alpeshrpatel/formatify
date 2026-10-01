const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Parse an OpenAPI 3.x document and expose operations with JSON payload schemas. */
export async function parseOpenApiSpec(sourceText) {
  const { parse } = await import('yaml');
  let spec;
  try {
    spec = parse(sourceText);
  } catch (cause) {
    throw new Error(`Could not parse the OpenAPI document: ${cause.message}`);
  }

  if (!spec || typeof spec !== 'object' || !/^3\./.test(spec.openapi ?? '')) {
    throw new Error('Provide a valid OpenAPI 3.x document in JSON or YAML.');
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error('The OpenAPI document does not contain a paths object.');
  }

  const operations = [];
  for (const [path, rawPathItem] of Object.entries(spec.paths)) {
    const pathItem = resolveReference(spec, rawPathItem);
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;

      const schemaOptions = [];
      const requestBody = operation.requestBody && resolveReference(spec, operation.requestBody);
      for (const media of jsonMediaTypes(requestBody?.content)) {
        if (media.schema) {
          schemaOptions.push({
            id: `request:${media.type}`,
            label: `Request · ${media.type}`,
            schema: prepareSchema(media.schema, spec),
          });
        }
      }

      const responses = operation.responses && resolveReference(spec, operation.responses);
      for (const [status, rawResponse] of Object.entries(responses ?? {})) {
        const response = resolveReference(spec, rawResponse);
        for (const media of jsonMediaTypes(response?.content)) {
          if (media.schema) {
            schemaOptions.push({
              id: `response:${status}:${media.type}`,
              label: `Response ${status} · ${media.type}`,
              schema: prepareSchema(media.schema, spec),
            });
          }
        }
      }

      if (schemaOptions.length === 0) continue;
      const operationId = operation.operationId ? ` · ${operation.operationId}` : '';
      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.description ?? '',
        label: `${method.toUpperCase()} ${path}${operationId}`,
        schemaOptions,
      });
    }
  }

  if (operations.length === 0) {
    throw new Error('No operations with JSON request or response schemas were found.');
  }
  return {
    title: spec.info?.title ?? 'OpenAPI document',
    version: spec.openapi,
    operations,
  };
}

function resolveReference(spec, value, depth = 0) {
  if (!value || typeof value !== 'object' || !value.$ref) return value;
  if (depth >= 20) throw new Error('OpenAPI references are nested too deeply.');
  if (!value.$ref.startsWith('#/')) {
    throw new Error(`External OpenAPI reference "${value.$ref}" is not supported. Keep the spec self-contained.`);
  }
  const target = resolvePointer(spec, value.$ref);
  if (!target || typeof target !== 'object') {
    throw new Error(`Could not resolve OpenAPI reference "${value.$ref}".`);
  }
  const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'));
  return resolveReference(spec, { ...target, ...siblings }, depth + 1);
}

function resolvePointer(root, pointer) {
  return pointer.slice(2).split('/').reduce((value, part) => {
    const key = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
    return value && typeof value === 'object' ? value[key] : undefined;
  }, root);
}

function jsonMediaTypes(content) {
  return Object.entries(content ?? {})
    .filter(([type]) => type === 'application/json' || type.endsWith('+json'))
    .sort(([left], [right]) => mediaTypeRank(left) - mediaTypeRank(right))
    .map(([type, media]) => ({ type, schema: media?.schema }));
}

function mediaTypeRank(type) {
  return type === 'application/json' ? 0 : 1;
}

function prepareSchema(schema, spec) {
  const definitions = Object.fromEntries(
    Object.entries(spec.components?.schemas ?? {}).map(([name, definition]) => [
      name,
      normalizeSchema(definition),
    ]),
  );
  const normalized = normalizeSchema(schema);
  return {
    ...normalized,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { ...definitions, ...(normalized.$defs ?? {}) },
  };
}

function normalizeSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return value;

  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'nullable' || key === 'example') continue;
    if (key === '$ref' && child.startsWith('#/components/schemas/')) {
      normalized[key] = child.replace('#/components/schemas/', '#/$defs/');
    } else {
      normalized[key] = normalizeSchema(child);
    }
  }

  if (value.nullable === true) {
    if (Array.isArray(normalized.type)) {
      if (!normalized.type.includes('null')) normalized.type.push('null');
    } else if (typeof normalized.type === 'string') {
      normalized.type = [normalized.type, 'null'];
    } else if (normalized.anyOf) {
      normalized.anyOf.push({ type: 'null' });
    } else {
      normalized.anyOf = [{ ...normalized }, { type: 'null' }];
    }
  }

  if (value.example !== undefined && normalized.examples === undefined) {
    normalized.examples = [value.example];
  }
  return normalized;
}