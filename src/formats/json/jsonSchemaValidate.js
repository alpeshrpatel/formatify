/** JsonSchemaValidate.js — lightweight JSON Schema (draft-07) validator.

   Supports the most commonly used keywords:
     - type, enum, const
     - minimum / maximum / exclusiveMinimum / exclusiveMaximum / multipleOf
     - minLength / maxLength / pattern / format
     - minItems / maxItems / uniqueItems
     - required / properties / additionalProperties
     - patternProperties
     - items (schema or tuple)
     - minProperties / maxProperties
     - allOf / anyOf / oneOf / not
     - if / then / else
     - $ref (local, same-document only)
     - definitions / $defs

   Returns { valid: boolean, errors: ValidationError[] }.
*/
export function validateJsonSchema(data, schema, rootSchema = schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { valid: true, errors: [] };
  }

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema, path);
    if (!resolved) {
      errors.push({ path, message: `Unresolvable $ref: "${schema.$ref}"` });
      return { valid: false, errors };
    }
    return validateJsonSchema(data, resolved, rootSchema, path);
  }

  if (schema.allOf) {
    for (let i = 0; i < schema.allOf.length; i += 1) {
      const sub = validateJsonSchema(data, schema.allOf[i], rootSchema, path);
      errors.push(...sub.errors.map((e) => ({ ...e, keyword: `allOf[${i}]/${e.keyword ?? ''}` })));
    }
  }
  if (schema.anyOf) {
    let anyValid = false;
    for (let i = 0; i < schema.anyOf.length; i += 1) {
      const sub = validateJsonSchema(data, schema.anyOf[i], rootSchema, path);
      if (sub.valid) { anyValid = true; break; }
    }
    if (!anyValid) {
      errors.push({ path, keyword: 'anyOf', message: 'Data does not match any of the given schemas.' });
    }
  }
  if (schema.oneOf) {
    let matchCount = 0;
    for (let i = 0; i < schema.oneOf.length; i += 1) {
      const sub = validateJsonSchema(data, schema.oneOf[i], rootSchema, path);
      if (sub.valid) matchCount += 1;
    }
    if (matchCount === 0) {
      errors.push({ path, keyword: 'oneOf', message: 'Data does not match any of the given schemas.' });
    } else if (matchCount > 1) {
      errors.push({ path, keyword: 'oneOf', message: `Data matches ${matchCount} schemas, but should match exactly one.` });
    }
  }
  if (schema.not) {
    const sub = validateJsonSchema(data, schema.not, rootSchema, path);
    if (sub.valid) {
      errors.push({ path, keyword: 'not', message: 'Data should NOT match the given schema, but it does.' });
    }
  }

  if ('if' in schema) {
    const ifResult = validateJsonSchema(data, schema.if, rootSchema, path);
    if (ifResult.valid && schema.then) {
      const thenResult = validateJsonSchema(data, schema.then, rootSchema, path);
      errors.push(...thenResult.errors);
    } else if (!ifResult.valid && schema.else) {
      const elseResult = validateJsonSchema(data, schema.else, rootSchema, path);
      errors.push(...elseResult.errors);
    }
  }

  if ('enum' in schema) {
    if (!schema.enum.includes(data)) {
      errors.push({
        path,
        keyword: 'enum',
        message: `Value is not one of the allowed values: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
      });
    }
  }

  if ('const' in schema) {
    if (data !== schema.const) {
      errors.push({ path, keyword: 'const', message: `Value must be exactly ${JSON.stringify(schema.const)}.` });
    }
  }

  if ('type' in schema) {
    const typeOk = checkType(data, schema.type);
    if (!typeOk) {
      const expected = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
      errors.push({ path, keyword: 'type', message: `Expected type "${expected}" but got ${describeType(data)}.` });
      return { valid: errors.length === 0, errors };
    }
  }

  if (data === null) return { valid: errors.length === 0, errors };

  if (typeof data === 'object') {
    if (Array.isArray(data)) errors.push(...validateArray(data, schema, rootSchema, path));
    else errors.push(...validateObject(data, schema, rootSchema, path));
  } else {
    errors.push(...validateScalar(data, schema, path));
  }

  return { valid: errors.length === 0, errors };
}

/** ---- helpers ---- */

function checkType(data, type) {
  if (Array.isArray(type)) return type.some((t) => checkType(data, t));
  if (type === 'any') return true;
  if (type === 'object' && data !== null && typeof data === 'object' && !Array.isArray(data)) return true;
  if (type === 'array' && Array.isArray(data)) return true;
  if (type === 'string' && typeof data === 'string') return true;
  if (type === 'number' && typeof data === 'number' && !Number.isNaN(data)) return true;
  if (type === 'integer' && typeof data === 'number' && Number.isFinite(data) && Number.isInteger(data)) return true;
  if (type === 'boolean' && typeof data === 'boolean') return true;
  if (type === 'null' && data === null) return true;
  return false;
}

function describeType(data) {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  return typeof data;
}

function resolveRef(ref, rootSchema, path) {
  if (!ref.startsWith('#')) return null;
  const fragment = ref.slice(1);
  if (!fragment.startsWith('/')) return null;
  const parts = fragment.split('/').slice(1);
  let current = rootSchema;
  for (const part of parts) {
    const decoded = decodeURIComponent(part);
    if (current && typeof current === 'object') {
      if (decoded in current) current = current[decoded];
      else return null;
    } else return null;
  }
  return current;
}

function validateObject(data, schema, rootSchema, path) {
  const errors = [];
  const required = schema.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (!(key in data)) {
        errors.push({ path: path + '/' + encodeURIComponent(key), keyword: 'required', message: `Required property "${key}" is missing.` });
      }
    }
  }
  const properties = schema.properties;
  if (properties && typeof properties === 'object') {
    for (const key of Object.keys(properties)) {
      if (key in data) {
        const childPath = path + '/' + encodeURIComponent(key);
        const sub = validateJsonSchema(data[key], properties[key], rootSchema, childPath);
        errors.push(...sub.errors);
      }
    }
  }
  const patternProperties = schema.patternProperties;
  if (patternProperties && typeof patternProperties === 'object') {
    for (const key of Object.keys(data)) {
      for (const regexStr of Object.keys(patternProperties)) {
        try {
          const re = new RegExp(regexStr);
          if (re.test(key)) {
            const childPath = path + '/' + encodeURIComponent(key);
            const sub = validateJsonSchema(data[key], patternProperties[regexStr], rootSchema, childPath);
            errors.push(...sub.errors);
          }
        } catch { /* invalid regex — skip */ }
      }
    }
  }

  validateAdditionalProperties(data, schema, rootSchema, path, properties, errors);

  const minProps = schema.minProperties;
  if (minProps !== undefined && Object.keys(data).length < minProps) {
    errors.push({ path, keyword: 'minProperties', message: `Object has ${Object.keys(data).length} properties, but minProperties is ${minProps}.` });
  }
  const maxProps = schema.maxProperties;
  if (maxProps !== undefined && Object.keys(data).length > maxProps) {
    errors.push({ path, keyword: 'maxProperties', message: `Object has ${Object.keys(data).length} properties, but maxProperties is ${maxProps}.` });
  }

  return errors;
}

/**
 * Enforce `additionalProperties`.
 *   - `false`   → reject any key not named in `properties` or `patternProperties`.
 *   - a schema  → validate every such key against it.
 */
function validateAdditionalProperties(data, schema, rootSchema, path, properties, errors) {
  const declared = schema.additionalProperties;
  if (declared === undefined || declared === true) return;
  const allowed = new Set(Object.keys(properties || {}));
  if (declared === false) {
    for (const key of Object.keys(data)) {
      if (!allowed.has(key) && !matchesPatternProperty(key, schema)) {
        errors.push({
          path: path + '/' + encodeURIComponent(key),
          keyword: 'additionalProperties',
          message: `Additional property "${key}" is not allowed.`,
        });
      }
    }
    return;
  }
  if (typeof declared === 'object') {
    for (const key of Object.keys(data)) {
      if (allowed.has(key) || matchesPatternProperty(key, schema)) continue;
      const childPath = path + '/' + encodeURIComponent(key);
      const sub = validateJsonSchema(data[key], declared, rootSchema, childPath);
      errors.push(...sub.errors);
    }
  }
}

function matchesPatternProperty(key, schema) {
  const patterns = schema.patternProperties;
  if (!patterns || typeof patterns !== 'object') return false;
  for (const pattern of Object.keys(patterns)) {
    try {
      if (new RegExp(pattern).test(key)) return true;
    } catch { /* invalid regex — ignore */ }
  }
  return false;
}

function validateArray(data, schema, rootSchema, path) {
  const errors = [];
  const len = data.length;

  const minItems = schema.minItems;
  if (minItems !== undefined && len < minItems) {
    errors.push({ path, keyword: 'minItems', message: `Array has ${len} items, but minItems is ${minItems}.` });
  }
  const maxItems = schema.maxItems;
  if (maxItems !== undefined && len > maxItems) {
    errors.push({ path, keyword: 'maxItems', message: `Array has ${len} items, but maxItems is ${maxItems}.` });
  }
  if (schema.uniqueItems) {
    const seen = new Map();
    for (let i = 0; i < len; i += 1) {
      const item = data[i];
      const key = item === null ? 'null' : typeof item === 'object' ? JSON.stringify(item) : String(item);
      if (seen.has(key)) {
        errors.push({ path: path + '[' + i + ']', keyword: 'uniqueItems', message: `Item at index ${i} is not unique.` });
        break;
      }
      seen.set(key, i);
    }
  }

  const itemsSchema = schema.items;
  if (itemsSchema) {
    if (Array.isArray(itemsSchema)) {
      for (let i = 0; i < Math.max(len, itemsSchema.length); i += 1) {
        if (i < itemsSchema.length && i < len) {
          const childPath = path + '[' + i + ']';
          const sub = validateJsonSchema(data[i], itemsSchema[i], rootSchema, childPath);
          errors.push(...sub.errors);
        } else if (i >= itemsSchema.length && schema.additionalItems === false) {
          errors.push({ path: path + '[' + i + ']', keyword: 'additionalItems', message: `Additional item at index ${i} is not allowed.` });
        } else if (i >= itemsSchema.length && schema.additionalItems && typeof schema.additionalItems === 'object') {
          const childPath = path + '[' + i + ']';
          const sub = validateJsonSchema(data[i], schema.additionalItems, rootSchema, childPath);
          errors.push(...sub.errors);
        }
      }
    } else if (typeof itemsSchema === 'object') {
      for (let i = 0; i < len; i += 1) {
        const childPath = path + '[' + i + ']';
        const sub = validateJsonSchema(data[i], itemsSchema, rootSchema, childPath);
        errors.push(...sub.errors);
      }
    }
  }

  return errors;
}

function validateScalar(data, schema, path) {
  const errors = [];
  const type = typeof data;

  if (type === 'string') {
    const minLen = schema.minLength;
    if (minLen !== undefined && data.length < minLen) {
      errors.push({ path, keyword: 'minLength', message: `String has ${data.length} characters, but minLength is ${minLen}.` });
    }
    const maxLen = schema.maxLength;
    if (maxLen !== undefined && data.length > maxLen) {
      errors.push({ path, keyword: 'maxLength', message: `String has ${data.length} characters, but maxLength is ${maxLen}.` });
    }
    if ('pattern' in schema) {
      try {
        const re = new RegExp(schema.pattern);
        if (!re.test(data)) {
          errors.push({ path, keyword: 'pattern', message: `String does not match pattern "${schema.pattern}".` });
        }
      } catch {
        errors.push({ path, keyword: 'pattern', message: `Invalid regex pattern: "${schema.pattern}".` });
      }
    }
    if ('format' in schema) {
      const fmt = schema.format;
      if (fmt === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
        errors.push({ path, keyword: 'format', message: `String is not a valid email address.` });
      } else if (fmt === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        errors.push({ path, keyword: 'format', message: `String is not a valid date (YYYY-MM-DD).` });
      } else if (fmt === 'time' && !/^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(data)) {
        errors.push({ path, keyword: 'format', message: `String is not a valid time.` });
      } else if (fmt === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(data)) {
        errors.push({ path, keyword: 'format', message: `String is not a valid date-time (ISO 8601).` });
      } else if (fmt === 'uri' && !/^https?:\/\//.test(data)) {
        errors.push({ path, keyword: 'format', message: `String is not a valid URI.` });
      }
    }
  }

  if (type === 'number' && Number.isFinite(data)) {
    if ('minimum' in schema && data < schema.minimum) {
      errors.push({ path, keyword: 'minimum', message: `Value ${data} is less than minimum ${schema.minimum}.` });
    }
    if ('maximum' in schema && data > schema.maximum) {
      errors.push({ path, keyword: 'maximum', message: `Value ${data} is greater than maximum ${schema.maximum}.` });
    }
    if ('exclusiveMinimum' in schema && schema.exclusiveMinimum !== null) {
      const min = Number(schema.exclusiveMinimum);
      if (data <= min) {
        errors.push({ path, keyword: 'exclusiveMinimum', message: `Value ${data} is not greater than exclusiveMinimum ${min}.` });
      }
    }
    if ('exclusiveMaximum' in schema && schema.exclusiveMaximum !== null) {
      const max = Number(schema.exclusiveMaximum);
      if (data >= max) {
        errors.push({ path, keyword: 'exclusiveMaximum', message: `Value ${data} is not less than exclusiveMaximum ${max}.` });
      }
    }
    if ('multipleOf' in schema) {
      const factor = data / schema.multipleOf;
      if (Math.abs(factor - Math.round(factor)) > 1e-10) {
        errors.push({ path, keyword: 'multipleOf', message: `Value ${data} is not a multiple of ${schema.multipleOf}.` });
      }
    }
  }

  return errors;
}

/**
 * Infer a JSON Schema (draft-07 style) from a sample JSON value.
 *
 * This is the inverse of `validateJsonSchema`: instead of checking data
 * against a schema, it describes the shape of the data. Useful for
 * bootstrapping a schema from a real payload.
 *
 * Arrays are collapsed into a single `items` schema; when the elements are
 * heterogeneous the inferred items become an `anyOf` union. Required
 * properties are those present on every object in the sample.
 */
export function inferSchema(value, options = {}) {
  return inferNode(value, options);
}

function inferNode(value, options) {
  if (value === null) return { type: 'null' };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array' };
    const itemSchemas = value.map((item) => inferNode(item, options));
    const merged = mergeSchemas(itemSchemas);
    return { type: 'array', items: merged };
  }

  switch (typeof value) {
    case 'boolean':
      return { type: 'boolean' };
    case 'number':
      return Number.isInteger(value)
        ? { type: 'integer' }
        : { type: 'number' };
    case 'string':
      return { type: 'string' };
    case 'object': {
      const properties = {};
      const keys = Object.keys(value);
      for (const key of keys) {
        properties[key] = inferNode(value[key], options);
      }
      const schema = { type: 'object', properties };
      if (options.requireAll !== false && keys.length > 0) {
        schema.required = [...keys];
      }
      return schema;
    }
    default:
      return {};
  }
}

/**
 * Merge a set of inferred schemas into one.
 * Identical shapes collapse to themselves; anything else becomes `anyOf`.
 * `integer` + `number` widens to `number` rather than a union.
 */
function mergeSchemas(schemas) {
  if (schemas.length === 0) return {};
  const unique = dedupe(schemas);
  if (unique.length === 1) return unique[0];

  // Widen integer/number pairs into a single `number`.
  const types = new Set(unique.map((s) => s.type));
  if (types.size === 2 && types.has('integer') && types.has('number')) {
    return { type: 'number' };
  }

  // Merge object schemas by unioning their properties.
  if (types.size === 1 && types.has('object')) {
    const allKeys = new Set();
    for (const schema of unique) {
      for (const key of Object.keys(schema.properties ?? {})) allKeys.add(key);
    }
    const presentInAll = [...allKeys].filter((key) =>
      unique.every((schema) => Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key)),
    );
    const properties = {};
    for (const key of allKeys) {
      properties[key] = mergeSchemas(
        unique
          .map((schema) => schema.properties?.[key])
          .filter((schema) => schema !== undefined),
      );
    }
    const merged = { type: 'object', properties };
    if (presentInAll.length > 0) merged.required = presentInAll;
    return merged;
  }

  return { anyOf: unique };
}

/** Drop schema objects that are deep-equal to an earlier entry. */
function dedupe(schemas) {
  const out = [];
  for (const schema of schemas) {
    if (!out.some((existing) => sameSchema(existing, schema))) out.push(schema);
  }
  return out;
}

function sameSchema(a, b) {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}