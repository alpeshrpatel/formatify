/**
 * jsonRepair.js
 * ---------------------------------------------------------------------------
 * "Auto fix" for the mistakes people actually make when hand-writing JSON.
 *
 * Two layers:
 *   1. a lexer based pass that rewrites the constructs that are wrong no matter
 *      where they appear (curly quotes, comments, single quotes, bare keys,
 *      NaN/Infinity/undefined, raw control characters, trailing commas)
 *   2. an error driven loop: whenever the parser still complains about a
 *      missing comma, the comma is inserted at the reported position and the
 *      document is parsed again (up to `maxPasses` times)
 *
 * Every change is reported so the UI can list exactly what it touched.
 */

import { validateJson, isSmartQuote } from './jsonParser.js';

const MAX_PASSES = 60;

/**
 * @param {string} text
 * @param {{ maxPasses?: number }} [options]
 * @returns {{ text: string, notes: { message: string, line?: number }[], changed: boolean, result: object }}
 */
export function repairJson(text, options = {}) {
  const maxPasses = options.maxPasses ?? MAX_PASSES;
  const notes = [];

  let current = text;
  current = fixSmartQuotes(current, notes);
  current = fixComments(current, notes);
  current = fixSingleQuotedStrings(current, notes);
  current = fixUnquotedKeys(current, notes);
  current = fixInvalidLiterals(current, notes);
  current = fixEscapedControlCharacters(current, notes);
  current = fixTrailingCommas(current, notes);
  current = fixWhitespaceCharacters(current, notes);

  // Error driven passes: insert the comma / close the bracket the parser asks for.
  let passes = 0;
  let result = validateJson(current);
  while (!result.ok && passes < maxPasses) {
    const patched = patchForError(current, result.error, notes);
    if (patched === null) break;
    current = patched;
    passes += 1;
    result = validateJson(current);
  }

  return {
    text: current,
    notes,
    changed: current !== text,
    result,
  };
}

/* -------------------------------------------------------------------------- */
/* character level fixes                                                      */
/* -------------------------------------------------------------------------- */

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Converts “curly” quotes into the ASCII quotes JSON understands.
 *
 * The tricky part is ’: it is used both to close a quoted string and as an
 * apostrophe ("don’t"). A curly quote squeezed between two word characters is
 * an apostrophe; everywhere else it is a delimiter and becomes a double quote.
 */
function fixSmartQuotes(text, notes) {
  if (![...text].some(isSmartQuote)) return text;

  let out = '';
  let count = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!isSmartQuote(ch)) {
      out += ch;
      continue;
    }
    count += 1;
    const isApostrophe = WORD_CHAR.test(text[i - 1] ?? '') && WORD_CHAR.test(text[i + 1] ?? '');
    if (isApostrophe) out += "'";
    else if (ch === '\u2032') out += "'";
    else out += '"';
  }

  notes.push({
    message: `Replaced ${count} curly/smart quote${count > 1 ? 's' : ''} with straight ASCII quotes.`,
  });
  return out;
}

/**
 * Removes `// line` and `/* block *​/` comments while respecting string
 * literals (a "//" inside a string is data, not a comment).
 */
function fixComments(text, notes) {
  let out = '';
  let removed = 0;
  let inString = false;
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      removed += 1;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      i -= 1; // keep the newline
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      removed += 1;
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1; // skip the closing '/'
      continue;
    }

    if (ch === '/' && text[i + 1] !== '/' && text[i + 1] !== '*') {
      // a stray slash where a value is expected: not repairable, keep as-is
      out += ch;
      continue;
    }

    out += ch;
  }

  if (removed) {
    notes.push({ message: `Removed ${removed} comment${removed > 1 ? 's' : ''} (JSON does not allow comments).` });
  }
  return out;
}

/** Turns `'value'` into `"value"` everywhere outside of double quoted strings. */
function fixSingleQuotedStrings(text, notes) {
  let out = '';
  let converted = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      // copy the double quoted string verbatim
      out += ch;
      i += 1;
      while (i < text.length) {
        out += text[i];
        if (text[i] === '\\') {
          out += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "'") {
      converted += 1;
      // consume the single quoted string
      let end = i + 1;
      while (end < text.length && text[end] !== "'") {
        if (text[end] === '\\') end += 1;
        end += 1;
      }
      const inner = text.slice(i + 1, end);
      out += `"${inner.replace(/(?<!\\)"/g, '\\"').replace(/\\'/g, "'")}"`;
      i = end + 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  if (converted) {
    notes.push({
      message: `Converted ${converted} single-quoted string${converted > 1 ? 's' : ''} to double quotes.`,
    });
  }
  return out;
}

/**
 * Rewrites the parts of the document that are *not* inside a string literal.
 * `rewriter` receives a chunk of code and returns its replacement.
 */
function rewriteOutsideStrings(text, rewriter) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== '"' && text[j] !== "'") j += 1;
    out += rewriter(text.slice(i, j));
    i = j;
  }
  return out;
}

/** `{ name: "Ada" }` -> `{ "name": "Ada" }` */
function fixUnquotedKeys(text, notes) {
  let out = '';
  let i = 0;
  let quoted = 0;
  const stack = [];
  let inString = null;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      out += ch;
      i += 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i))[0];
      const isLiteral = word === 'true' || word === 'false' || word === 'null';
      const restStartsColon = /^\s*:/.test(text.slice(i + word.length));
      if (stack[stack.length - 1] === '{' && restStartsColon && !isLiteral) {
        out += `"${word}"`;
        quoted += 1;
      } else {
        out += word;
      }
      i += word.length;
      continue;
    }

    out += ch;
    i += 1;
  }

  if (quoted) {
    notes.push({ message: `Quoted ${quoted} unquoted object key${quoted > 1 ? 's' : ''}.` });
  }
  return out;
}

/** `NaN`, `Infinity`, `-Infinity` and `undefined` become `null`; `True` becomes `true`. */
function fixInvalidLiterals(text, notes) {
  let replaced = 0;
  let lowercased = 0;

  const out = rewriteOutsideStrings(text, (chunk) =>
    chunk.replace(/(?<![\w$.])-?(Infinity|NaN|undefined|true|false|null)(?![\w$])/gi, (match, word) => {
      const lower = word.toLowerCase();
      if (lower === 'true' || lower === 'false' || lower === 'null') {
        if (match === lower) return match;
        lowercased += 1;
        return lower;
      }
      replaced += 1;
      return 'null';
    }),
  );

  if (lowercased) {
    notes.push({
      message: `Lowercased ${lowercased} JSON literal${lowercased > 1 ? 's' : ''} (true / false / null).`,
    });
  }
  if (replaced) {
    notes.push({
      message: `Replaced ${replaced} invalid literal${replaced > 1 ? 's' : ''} (NaN / Infinity / undefined) with null.`,
    });
  }
  return out;
}

const CONTROL_ESCAPES = {
  '\u0000': '\\u0000',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\u000B': '\\u000b',
  '\f': '\\f',
  '\r': '\\r',
};

/** Escapes raw tabs/newlines inside strings, which JSON forbids. */
function fixEscapedControlCharacters(text, notes) {
  let count = 0;
  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch !== '"' && ch !== "'") {
      out += ch;
      i += 1;
      continue;
    }

    const quote = ch;
    out += ch;
    i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        out += c + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (c === quote) {
        out += c;
        i += 1;
        break;
      }
      const code = c.codePointAt(0);
      if (code < 0x20) {
        const escape =
          CONTROL_ESCAPES[c] ?? `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
        out += escape;
        count += 1;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    }
  }

  if (count) {
    notes.push({
      message: `Escaped ${count} raw control character${count > 1 ? 's' : ''} inside a string.`,
    });
  }
  return out;
}

/** `[1, 2, 3,]` -> `[1, 2, 3]` */
function fixTrailingCommas(text, notes) {
  let count = 0;
  const out = rewriteOutsideStrings(text, (chunk) =>
    chunk.replace(/,(\s*)([}\]])/g, (_match, whitespace, bracket) => {
      count += 1;
      return `${whitespace}${bracket}`;
    }),
  );
  if (count) {
    notes.push({ message: `Removed ${count} trailing comma${count > 1 ? 's' : ''}.` });
  }
  return out;
}

/** NO-BREAK SPACE, ideographic space, line separator, BOM … -> plain space. */
function fixWhitespaceCharacters(text, notes) {
  let count = 0;
  const out = text.replace(
    /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g,
    (match) => {
      if (match === '\uFEFF') return '';
      count += 1;
      return ' ';
    },
  );
  if (count) {
    notes.push({
      message: `Replaced ${count} invisible whitespace character${count > 1 ? 's' : ''} with a normal space.`,
    });
  }
  return out;
}


/* -------------------------------------------------------------------------- */
/* error driven fixes                                                         */
/* -------------------------------------------------------------------------- */

const tokenLabel = (token) =>
  token === undefined || token === '' ? 'the next item' : `"${token}"`;

/**
 * Applies one fix based on the parser's complaint.
 * @returns {string|null} the patched document, or null when nothing can be done
 */
function patchForError(text, error, notes) {
  const { code, index, token, line } = error;

  const note = (message) => {
    notes.push({ message, line });
    return true;
  };

  if (code === 'missing-comma') {
    if (text[index] === ';') {
      note(`Line ${line}: replaced a semicolon with a comma.`);
      return `${text.slice(0, index)},${text.slice(index + 1)}`;
    }
    note(`Line ${line}: inserted a missing comma before ${tokenLabel(token)}.`);
    return `${text.slice(0, index)},${text.slice(index)}`;
  }

  if (code === 'trailing-comma' || (code === 'unexpected-token' && token === ',')) {
    const commaIndex = text[index] === ',' ? index : text.lastIndexOf(',', index);
    if (commaIndex < 0) return null;
    note(`Line ${line}: removed a comma that has no value after it.`);
    return `${text.slice(0, commaIndex)}${text.slice(commaIndex + 1)}`;
  }

  if (code === 'unterminated-object' || code === 'unterminated-array') {
    const closer = code === 'unterminated-object' ? '}' : ']';
    const trimmed = text.replace(/\s+$/, '');
    if (trimmed.endsWith(':')) {
      note(`Line ${line}: an open bracket was never closed — added the missing ${closer}.`);
      return `${trimmed} null\n${closer}\n`;
    }
    note(`Line ${line}: an open bracket was never closed — added the missing ${closer} at the end.`);
    return `${text}${closer}\n`;
  }

  if (code === 'unexpected-eof' && text.replace(/\s+$/, '').endsWith(':')) {
    note(`Line ${line}: a value was missing after the colon — inserted null.`);
    return `${text.replace(/\s+$/, '')} null`;
  }

  if (code === 'unmatched-bracket' || code === 'mismatched-bracket') {
    if (text[index] === '}' || text[index] === ']') {
      note(`Line ${line}: removed a stray "${text[index]}".`);
      return `${text.slice(0, index)}${text.slice(index + 1)}`;
    }
    return null;
  }

  return null;
}

