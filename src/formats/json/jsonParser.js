/**
 * jsonParser.js
 * ---------------------------------------------------------------------------
 * A strict, dependency-free JSON parser (RFC 8259) whose whole purpose is to
 * tell the user *exactly* what is wrong with their document:
 *
 *   - the precise `index`, `line` and `column` of the offending character
 *   - a code frame with a caret pointing at the character
 *   - a human readable explanation plus a "how to fix it" hint
 *   - a stable `code` so the UI (and the auto-fixer) can react to it
 *
 * `JSON.parse` is intentionally NOT used for error reporting: its messages are
 * short, engine specific and it never tells you *why* the document is invalid.
 * It is used in the test-suite as an oracle for validity though.
 */

/* -------------------------------------------------------------------------- */
/* constants                                                                  */
/* -------------------------------------------------------------------------- */

/** The only whitespace characters JSON allows between tokens. */
export const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Nesting deeper than this aborts with a friendly error instead of a crash. */
export const DEFAULT_MAX_DEPTH = 512;

const CONTROL_CHAR_NAMES = {
  '\u0000': 'NUL (U+0000)',
  '\u0001': 'U+0001',
  '\u0002': 'U+0002',
  '\u0003': 'U+0003',
  '\u0004': 'U+0004',
  '\u0005': 'U+0005',
  '\u0006': 'U+0006',
  '\u0007': 'U+0007',
  '\b': 'BACKSPACE (U+0008)',
  '\t': 'TAB (U+0009)',
  '\n': 'LINE FEED (U+000A)',
  '\u000B': 'VERTICAL TAB (U+000B)',
  '\f': 'FORM FEED (U+000C)',
  '\r': 'CARRIAGE RETURN (U+000D)',
  '\u000E': 'U+000E',
  '\u000F': 'U+000F',
};

const CONTROL_CHAR_ESCAPES = {
  '\u0000': '\\u0000',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\u000B': '\\u000b',
  '\f': '\\f',
  '\r': '\\r',
};

/** Characters that are "whitespace" to humans but illegal in JSON. */
const LOOKALIKE_WHITESPACE = new Map([
  ['\u00A0', 'NO-BREAK SPACE (U+00A0)'],
  ['\u1680', 'OGHAM SPACE MARK (U+1680)'],
  ['\u2000', 'EN QUAD (U+2000)'],
  ['\u2001', 'EM QUAD (U+2001)'],
  ['\u2002', 'EN SPACE (U+2002)'],
  ['\u2003', 'EM SPACE (U+2003)'],
  ['\u2004', 'THREE-PER-EM SPACE (U+2004)'],
  ['\u2005', 'FOUR-PER-EM SPACE (U+2005)'],
  ['\u2006', 'SIX-PER-EM SPACE (U+2006)'],
  ['\u2007', 'FIGURE SPACE (U+2007)'],
  ['\u2008', 'PUNCTUATION SPACE (U+2008)'],
  ['\u2009', 'THIN SPACE (U+2009)'],
  ['\u200A', 'HAIR SPACE (U+200A)'],
  ['\u2028', 'LINE SEPARATOR (U+2028)'],
  ['\u2029', 'PARAGRAPH SEPARATOR (U+2029)'],
  ['\u202F', 'NARROW NO-BREAK SPACE (U+202F)'],
  ['\u205F', 'MEDIUM MATHEMATICAL SPACE (U+205F)'],
  ['\u3000', 'IDEOGRAPHIC SPACE (U+3000)'],
  ['\uFEFF', 'ZERO WIDTH NO-BREAK SPACE / BOM (U+FEFF)'],
]);

const SMART_QUOTES = new Set(['\u2018', '\u2019', '\u201A', '\u201B', '\u201C', '\u201D', '\u201E', '\u201F', '\u2032', '\u2033', '`']);
const SMART_QUOTE_FIX = {
  '\u2018': '"', '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
  '\u2032': "'", '\u2033': '"', '`': '"',
};

/* -------------------------------------------------------------------------- */
/* error type                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A JSON syntax error enriched with everything a UI needs to point the user at
 * the exact spot in their document.
 */
export class JsonSyntaxError extends Error {
  constructor({
    message,
    hint = '',
    code = 'syntax-error',
    index = 0,
    line = 1,
    column = 1,
    token = '',
    codeFrame = '',
    snippet = null,
  }) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.message = message;
    this.hint = hint;
    this.code = code;
    this.index = index;
    this.line = line;
    this.column = column;
    this.token = token;
    this.codeFrame = codeFrame;
    /** { text, highlightStart, highlightEnd } or null (used for inline marks) */
    this.snippet = snippet;
  }

  /** "Line 4, column 12" — the sentence every user wants to read. */
  get location() {
    return `Line ${this.line}, column ${this.column}`;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      index: this.index,
      line: this.line,
      column: this.column,
      token: this.token,
      codeFrame: this.codeFrame,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* tiny helpers                                                               */
/* -------------------------------------------------------------------------- */

export const isDigit = (ch) => ch >= '0' && ch <= '9';

export const isHex = (ch) =>
  (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');

/** `'@' (U+0040)` for printable chars, `U+0009` for control chars. */
export function describeChar(ch) {
  if (ch === undefined || ch === '') return 'the end of input';
  const cp = ch.codePointAt(0);
  const hex = cp.toString(16).toUpperCase().padStart(4, '0');
  const printable = cp >= 0x20 && cp !== 0x7f;
  return printable ? `'${ch}' (U+${hex})` : `U+${hex}`;
}

/** Human label for a codepoint, e.g. 0x00A0 -> "NO-BREAK SPACE (U+00A0)". */
export function describeCodePoint(cp) {
  const ch = String.fromCodePoint(cp);
  return (
    LOOKALIKE_WHITESPACE.get(ch) ??
    CONTROL_CHAR_NAMES[ch] ??
    `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  );
}

/** Replace the "curly" quotes Word/Slack/Docs love to insert. */
export function normalizeSmartQuotes(ch) {
  return SMART_QUOTE_FIX[ch] ?? ch;
}

export const isSmartQuote = (ch) => SMART_QUOTES.has(ch);

/* -------------------------------------------------------------------------- */
/* parser                                                                     */
/* -------------------------------------------------------------------------- */

class Parser {
  constructor(text, options = {}) {
    this.text = text;
    this.length = text.length;
    this.pos = 0;
    this.depth = 0;
    this.warnings = [];
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.lineStartsCache = null;
  }

  /* ------------------------------ positions ------------------------------ */

  /** Offsets of the first character of every line (handles \n, \r and \r\n). */
  get lineStarts() {
    if (!this.lineStartsCache) {
      const starts = [0];
      for (let i = 0; i < this.length; i += 1) {
        const ch = this.text[i];
        if (ch === '\n') starts.push(i + 1);
        else if (ch === '\r') {
          if (this.text[i + 1] === '\n') i += 1;
          starts.push(i + 1);
        }
      }
      this.lineStartsCache = starts;
    }
    return this.lineStartsCache;
  }

  /** Binary search: character index -> { line, column } (both 1 based). */
  lineColumnAt(index) {
    const starts = this.lineStarts;
    const safe = Math.max(0, Math.min(index, this.length));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= safe) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: safe - starts[lo] + 1 };
  }

  /** The raw text of a line (without its trailing newline characters). */
  lineText(lineNumber) {
    const starts = this.lineStarts;
    const start = starts[lineNumber - 1] ?? 0;
    let end = lineNumber < starts.length ? starts[lineNumber] : this.length;
    while (end > start && (this.text[end - 1] === '\n' || this.text[end - 1] === '\r')) end -= 1;
    return this.text.slice(start, end);
  }

  /**
   * Renders the classic compiler style code frame:
   *
   *     3 |   "name": "Ada",
   *   > 4 |   "age": 36,,
   *       |             ^
   *     5 | }
   *
   * Tabs are expanded so the caret always lines up with the character.
   */
  codeFrameAt(index, radius = 2) {
    const { line, column } = this.lineColumnAt(index);
    const totalLines = this.lineStarts.length;
    const first = Math.max(1, line - radius);
    const last = Math.min(totalLines, line + radius);
    const gutter = String(last).length;
    const rows = [];
    for (let n = first; n <= last; n += 1) {
      const raw = this.lineText(n);
      const isErrorLine = n === line;
      rows.push(
        `${isErrorLine ? '>' : ' '} ${String(n).padStart(gutter)} | ${raw.replace(/\t/g, '    ')}`,
      );
      if (isErrorLine) {
        const before = raw.slice(0, Math.max(0, column - 1)).replace(/\t/g, '    ');
        rows.push(`${' '.repeat(gutter + 3)}| ${' '.repeat(before.length)}^`);
      }
    }
    return rows.join('\n');
  }

  /** Builds (and throws) a fully located syntax error. */
  fail(message, { code = 'syntax-error', hint = '', token = '', index = this.pos } = {}) {
    const at = Math.max(0, Math.min(index, this.length));
    const { line, column } = this.lineColumnAt(at);
    throw new JsonSyntaxError({
      message,
      hint,
      code,
      token,
      index: at,
      line,
      column,
      codeFrame: this.codeFrameAt(at),
      snippet: { text: this.lineText(line), highlightStart: column - 1, highlightEnd: column },
    });
  }

  warn(code, message, index = this.pos) {
    const { line, column } = this.lineColumnAt(index);
    this.warnings.push({ code, message, index, line, column });
  }

  /* --------------------------- character access -------------------------- */

  current() {
    return this.text[this.pos];
  }

  isEnd() {
    return this.pos >= this.length;
  }

  peek(offset = 1) {
    return this.text[this.pos + offset];
  }

  startsWith(word) {
    return this.text.startsWith(word, this.pos);
  }

  /* ------------------------------ scanning ------------------------------- */

  skipWhitespace() {
    while (this.pos < this.length) {
      const ch = this.text[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos += 1;
        continue;
      }
      const lookalike = LOOKALIKE_WHITESPACE.get(ch);
      if (lookalike) {
        this.fail(`Found ${lookalike}, which JSON does not treat as whitespace.`, {
          code: 'invalid-whitespace',
          hint:
            'Replace it with a normal space, a tab, or a line break. Invisible characters are usually pasted in from a word processor or a web page.',
          token: ch,
        });
      }
      break;
    }
  }
  /* ---------------------------- entry point ------------------------------ */

  parseDocument() {
    if (this.text[0] === '\uFEFF') {
      this.warn(
        'bom',
        'The document starts with a UTF-8 byte order mark (U+FEFF). It was skipped here, but some strict JSON parsers reject it.',
        0,
      );
      this.pos = 1;
    }

    if (this.text.replace(/[\s\uFEFF]/g, '').length === 0) {
      this.fail('The document is empty — there is no JSON value to parse.', {
        code: 'empty',
        hint: 'Paste or type some JSON, or press "Load sample" to see the expected shape.',
        index: 0,
      });
    }

    this.skipWhitespace();
    const node = this.parseValue();
    this.skipWhitespace();
    if (!this.isEnd()) this.failExtraContent();

    return { value: materialize(node), node, warnings: this.warnings };
  }

  /** The document held a valid value but then kept going. */
  failExtraContent() {
    const rest = this.text.slice(this.pos);
    const token = rest.trim().split(/\s/)[0].slice(0, 24);
    const looksLikeValue = /^[[{"\-0-9]/.test(rest.trim()) || /^(true|false|null)\b/.test(rest.trim());
    const isMultiline = /[\r\n]/.test(rest) && /\S/.test(rest);

    if (looksLikeValue && isMultiline) {
      this.fail('Unexpected extra content: a second JSON value follows the first one.', {
        code: 'extra-content',
        hint:
          'This looks like "JSON Lines" (one document per line). JSON allows a single top-level value — wrap the documents in an array, e.g. [ { ... }, { ... } ].',
        token,
      });
    }
    this.fail(
      `Unexpected extra content after the end of the document: found ${describeChar(this.current())}.`,
      {
        code: 'extra-content',
        hint:
          'A JSON document may only contain one top-level value. Wrap the values in an array (e.g. [ ... ]) or join them with commas.',
        token,
      },
    );
  }
  /* ------------------------------- values -------------------------------- */

  parseValue() {
    if (this.depth > this.maxDepth) {
      this.fail(`The document is nested more than ${this.maxDepth} levels deep.`, {
        code: 'max-depth',
        hint: 'Deeply nested JSON is usually produced by a bug or by a decompression bomb. Flatten the structure before formatting it.',
      });
    }
    this.skipWhitespace();
    if (this.isEnd()) {
      this.fail('Unexpected end of input: a JSON value was expected here.', {
        code: 'unexpected-eof',
        hint: 'Every value must be one of: object { ... }, array [ ... ], "string", number, true, false or null.',
      });
    }

    const ch = this.current();
    switch (ch) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"':
        return this.parseString();
      case 't':
        return this.parseKeyword('true', 'boolean', true);
      case 'f':
        return this.parseKeyword('false', 'boolean', false);
      case 'n':
        return this.parseKeyword('null', 'null', null);
      default:
        break;
    }

    if (ch === '-' || ch === '+' || ch === '.' || isDigit(ch)) {
      if (this.startsWith('-Infinity')) {
        this.fail('Infinity is not a valid JSON number.', {
          code: 'invalid-literal',
          hint: 'Use a finite number such as 0, or the string "-Infinity" if you really need that value.',
          token: '-Infinity',
        });
      }
      return this.parseNumber();
    }

    const diagnosis = diagnoseValueCharacter(ch, this.text.slice(this.pos));
    return this.fail(diagnosis.message, {
      code: diagnosis.code,
      hint: diagnosis.hint,
      token: diagnosis.token ?? ch,
    });
  }

  /** true / false / null — with a nudge when the casing or spelling is off. */
  parseKeyword(word, type, value) {
    if (this.startsWith(word)) {
      const start = this.pos;
      this.pos += word.length;
      return { type, value, raw: word, start, end: this.pos };
    }
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.text.slice(this.pos));
    const found = identifier ? identifier[0] : this.current();
    let hint = `JSON literals are lowercase and unquoted: true, false and null.`;
    if (typeof found === 'string' && found.toLowerCase() === word) {
      hint = `JSON is case sensitive — write it in lowercase: ${word}.`;
    } else if (found.startsWith(word[0])) {
      hint = `Did you mean ${word}? ${hint}`;
    }
    this.fail(`Unexpected identifier "${found}" — expected the literal ${word}.`, {
      code: 'invalid-literal',
      hint,
      token: String(found),
    });
  }
  /* ------------------------------ containers ----------------------------- */

  /** Shared "you forgot to close the bracket" reporting. */
  failUnterminated(kind, start) {
    const openChar = kind === 'object' ? '{' : '[';
    const closeChar = kind === 'object' ? '}' : ']';
    const opened = this.lineColumnAt(start);
    const endLine = this.lineColumnAt(this.length).line;
    this.fail(
      `Unterminated ${kind}: the closing '${closeChar}' for the '${openChar}' opened at line ${opened.line}, column ${opened.column} is missing.`,
      {
        code: `unterminated-${kind}`,
        hint: `Add the missing '${closeChar}'. The document ends on line ${endLine}.`,
        index: start,
        token: openChar,
      },
    );
  }

  /** Shared diagnosis for characters that can never appear inside a container. */
  rejectCommentOrSmartQuote(ch, where = '') {
    if (ch === '/' && (this.peek() === '/' || this.peek() === '*')) {
      const block = this.peek() === '*';
      this.fail(
        `Comments are not allowed in JSON${block ? ' (block comment “/* … */”)' : ' (line comment “// …”)'}.`,
        {
          code: 'comment',
          hint: 'Delete the comment — JSON has no comment syntax (only JSONC and JSON5 add one).',
          token: block ? '/*' : '//',
        },
      );
    }
    if (isSmartQuote(ch)) {
      this.fail(
        `Found a “curly” quote (${describeCodePoint(ch.codePointAt(0))}) where a straight double quote (") was expected${where}.`,
        {
          code: 'smart-quote',
          hint: 'Replace the curly quotes with plain ASCII quotes — word processors, chat apps and design tools insert them automatically.',
          token: ch,
        },
      );
    }
  }

  parseObject() {
    const start = this.pos;
    const entries = [];
    const seen = new Map();
    this.pos += 1; // '{'
    this.depth += 1;

    this.skipWhitespace();
    if (this.current() === '}') {
      this.pos += 1;
      this.depth -= 1;
      return { type: 'object', entries, start, end: this.pos };
    }

    for (;;) {
      this.skipWhitespace();
      if (this.isEnd()) this.failUnterminated('object', start);

      const keyIndex = this.pos;
      const ch = this.current();
      this.rejectCommentOrSmartQuote(ch, ' in the property name position');

      if (ch === '}') {
        this.fail('Trailing comma before "}" is not allowed.', {
          code: 'trailing-comma',
          hint: 'Remove the comma that follows the last property — the object must end with: "lastKey": value }',
          token: '}',
        });
      }
      if (ch === ']') {
        this.fail("Mismatched brackets: found ']' but the container that is open here starts with '{'.", {
          code: 'mismatched-bracket',
          hint: 'Objects are closed with "}", arrays with "]". Use "}" to close this object.',
          token: ']',
        });
      }

      let key;
      if (ch === '"') {
        const keyNode = this.parseString();
        key = keyNode.value;
      } else if (ch === "'") {
        const end = this.text.indexOf("'", keyIndex + 1);
        const word = end === -1 ? this.text.slice(keyIndex + 1, keyIndex + 33) : this.text.slice(keyIndex + 1, end);
        this.fail(`Single-quoted strings are not valid JSON — found the property name '${word}'.`, {
          code: 'single-quote',
          hint: `Wrap the property name in double quotes: "${word}": value`,
          token: word,
        });
      } else if (isIdentifierStart(ch)) {
        const word = (/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.text.slice(this.pos)) ?? [''])[0];
        this.fail(`Object property names must be double-quoted strings — found the bare name "${word}".`, {
          code: 'unquoted-key',
          hint: `Wrap the key in double quotes: "${word}": value`,
          token: word,
        });
      } else if (ch === ',') {
        this.fail("Unexpected ',' — a property name is expected after it.", {
          code: 'unexpected-token',
          hint: 'Remove the extra comma, or add the property it was meant to separate.',
          token: ',',
        });
      } else {
        this.fail(
          `Unexpected ${describeChar(ch)} — expected a property name in double quotes or the closing '}'.`,
          {
            code: 'unexpected-token',
            hint: 'An object is a list of "name": value pairs, for example: { "id": 1 }.',
            token: ch ?? '',
          },
        );
      }

      this.skipWhitespace();
      if (this.current() !== ':') {
        if (this.isEnd()) this.failUnterminated('object', start);
        const found = describeChar(this.current());
        const looksLikeEquals = this.current() === '=';
        this.fail(`Expected ':' after the property name "${key}", but found ${found}.`, {
          code: 'missing-colon',
          hint: looksLikeEquals
            ? 'JSON uses ":" between a name and its value, for example: "name": "Ada".'
            : `Property syntax is "name": value — add the missing colon after "${key}".`,
          token: this.current(),
        });
      }
      this.pos += 1; // ':'

      const value = this.parseValue();

      const previous = seen.get(key);
      if (previous !== undefined) {
        const firstAt = this.lineColumnAt(previous);
        this.warn(
          'duplicate-key',
          `Duplicate property "${key}": the value on line ${firstAt.line}, column ${firstAt.column} is overwritten by this one (the last value wins).`,
          keyIndex,
        );
      }
      seen.set(key, keyIndex);
      entries.push({ key, value, keyIndex });

      this.skipWhitespace();
      const after = this.current();
      this.rejectCommentOrSmartQuote(after);

      if (after === ',') {
        this.pos += 1;
        continue;
      }
      if (after === '}') {
        this.pos += 1;
        break;
      }
      if (after === undefined) this.failUnterminated('object', start);
      if (after === ';') {
        this.fail("JSON does not use semicolons — found ';' between properties.", {
          code: 'missing-comma',
          hint: 'Replace the ";" with a comma: "key": value,',
          token: ';',
        });
      }
      if (after === ']') {
        this.fail("Mismatched brackets: found ']' but the container that is open here starts with '{'.", {
          code: 'mismatched-bracket',
          hint: 'Objects are closed with "}", arrays with "]". Use "}" to close this object.',
          token: ']',
        });
      }
      this.fail(
        `Expected ',' or '}' after the property "${key}", but found ${describeChar(after)}.`,
        {
          code: 'missing-comma',
          hint: `Add a comma between the properties: "…": …, "…": …`,
          token: after,
        },
      );
    }

    this.depth -= 1;
    return { type: 'object', entries, start, end: this.pos };
  }
  parseArray() {
    const start = this.pos;
    const items = [];
    this.pos += 1; // '['
    this.depth += 1;

    this.skipWhitespace();
    if (this.current() === ']') {
      this.pos += 1;
      this.depth -= 1;
      return { type: 'array', items, start, end: this.pos };
    }

    for (;;) {
      this.skipWhitespace();
      if (this.isEnd()) this.failUnterminated('array', start);

      const ch = this.current();
      if (ch === ']') {
        this.fail('Trailing comma before "]" is not allowed.', {
          code: 'trailing-comma',
          hint: 'Remove the comma that follows the last item — the array must end with: lastItem ]',
          token: ']',
        });
      }
      if (ch === '}') {
        this.fail("Mismatched brackets: found '}' but the container that is open here starts with '['.", {
          code: 'mismatched-bracket',
          hint: 'Arrays are closed with "]", objects with "}". Use "]" to close this array.',
          token: '}',
        });
      }

      items.push(this.parseValue());

      this.skipWhitespace();
      const after = this.current();
      this.rejectCommentOrSmartQuote(after);

      if (after === ',') {
        this.pos += 1;
        continue;
      }
      if (after === ']') {
        this.pos += 1;
        break;
      }
      if (after === undefined) this.failUnterminated('array', start);
      if (after === ';') {
        this.fail("JSON does not use semicolons — found ';' between array items.", {
          code: 'missing-comma',
          hint: 'Replace the ";" with a comma: [ 1, 2, 3 ]',
          token: ';',
        });
      }
      if (after === '}') {
        this.fail("Mismatched brackets: found '}' but the container that is open here starts with '['.", {
          code: 'mismatched-bracket',
          hint: 'Arrays are closed with "]", objects with "}". Use "]" to close this array.',
          token: '}',
        });
      }
      this.fail(`Expected ',' or ']' after the array item, but found ${describeChar(after)}.`, {
        code: 'missing-comma',
        hint: 'Separate the items of an array with commas: [ 1, 2, 3 ]',
        token: after,
      });
    }

    this.depth -= 1;
    return { type: 'array', items, start, end: this.pos };
  }
  /* ------------------------------- strings ------------------------------- */

  parseString() {
    const start = this.pos;
    this.pos += 1; // opening quote
    let value = '';

    for (;;) {
      if (this.isEnd()) {
        this.fail('Unterminated string: the closing double quote (") is missing.', {
          code: 'unterminated-string',
          hint: 'Add the closing " — and make sure any quote inside the string is escaped as \\".',
          index: start,
          token: '"',
        });
      }

      const ch = this.text[this.pos];

      if (ch === '"') {
        this.pos += 1;
        break;
      }
      if (isSmartQuote(ch)) {
        this.fail(
          `Found a “curly” quote (${describeCodePoint(ch.codePointAt(0))}) inside a string instead of a straight double quote (").`,
          {
            code: 'smart-quote',
            hint: 'Replace the curly quotes with plain ASCII quotes — word processors, chat apps and design tools insert them automatically.',
            token: ch,
          },
        );
      }
      if (ch === '\\') {
        value += this.readEscape();
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        this.fail('Unescaped line break inside a string.', {
          code: 'unescaped-newline',
          hint: 'Strings may not span lines. Escape the break as \\n, or use \\\\ for a literal backslash.',
          token: ch,
        });
      }

      const code = ch.codePointAt(0);
      if (code < 0x20) {
        const name =
          CONTROL_CHAR_NAMES[ch] ?? `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
        const escape =
          CONTROL_CHAR_ESCAPES[ch] ?? `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
        this.fail(`Unescaped control character ${name} inside a string.`, {
          code: 'control-char',
          hint: `Escape it as ${escape}.`,
          token: ch,
        });
      }

      value += ch;
      this.pos += 1;
    }

    const raw = this.text.slice(start, this.pos);
    if (LONE_SURROGATE.test(value)) {
      this.warn(
        'lone-surrogate',
        'The string contains an unpaired surrogate (\\uD800-\\uDFFF). It is valid JSON, but it will not survive a UTF-8 round trip.',
        start,
      );
    }

    return { type: 'string', value, raw, start, end: this.pos };
  }

  /** Consumes a backslash escape and returns the character it denotes. */
  readEscape() {
    const escapeStart = this.pos;
    this.pos += 1; // backslash

    if (this.isEnd()) {
      this.fail('Unterminated escape sequence: the document ends with a lone backslash.', {
        code: 'unterminated-string',
        hint: 'Escape a literal backslash as \\\\, or add the missing closing quote.',
        index: escapeStart,
        token: '\\',
      });
    }

    const ch = this.text[this.pos];
    this.pos += 1;

    switch (ch) {
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        const hex = this.text.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.fail(`Invalid Unicode escape sequence "\\u${hex}" — 4 hexadecimal digits are required.`, {
            code: 'bad-unicode-escape',
            hint: 'Write the code point as \\uXXXX, for example \\u00e9 for é or \\u2764 for ❤.',
            index: escapeStart,
            token: `\\u${hex}`,
          });
        }
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      case 'x':
      case 'U':
        this.fail(`Invalid escape sequence "\\${ch}".`, {
          code: 'bad-escape',
          hint: `JavaScript's "\\${ch}" escape does not exist in JSON. Use \\uXXXX (4 hex digits) instead.`,
          index: escapeStart,
          token: `\\${ch}`,
        });
        return '';
      case '0':
        this.fail('Invalid escape sequence "\\0".', {
          code: 'bad-escape',
          hint: 'JSON has no \\0 escape. Use \\u0000 for a NUL character.',
          index: escapeStart,
          token: '\\0',
        });
        return '';
      case '\n':
      case '\r':
        this.fail(
          'Invalid line continuation: a backslash at the end of a line does not continue a string in JSON.',
          {
            code: 'unescaped-newline',
            hint: 'Remove the trailing backslash, or escape the line break as \\n.',
            index: escapeStart,
            token: '\\',
          },
        );
        return '';
      default: {
        const shown =
          ch === undefined || ch.codePointAt(0) < 0x20 ? 'a control character' : `"\\${ch}"`;
        this.fail(`Invalid escape sequence ${shown}.`, {
          code: 'bad-escape',
          hint: 'The valid escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.',
          index: escapeStart,
          token: `\\${ch ?? ''}`,
        });
        return '';
      }
    }
  }
  /* ------------------------------- numbers ------------------------------- */

  parseNumber() {
    const start = this.pos;
    const text = this.text;
    let i = this.pos;

    if (text[i] === '-') i += 1;

    if (text[i] === '+') {
      this.fail('Numbers may not begin with a plus sign.', {
        code: 'plus-sign',
        hint: 'Write positive numbers without a sign: 12 instead of +12.',
        index: start,
        token: '+',
      });
    }

    if (text[i] === '.') {
      const word = (text.slice(start, start + 16).split(/[\s,\]}]+/)[0] || '.');
      this.fail('A number must have at least one digit before the decimal point.', {
        code: 'leading-decimal-point',
        hint: `Write "0${word.replace('-', '-0')}" instead of "${word}" — JSON requires a leading zero.`,
        index: start,
        token: word,
      });
    }

    if (text[i] === '0' && isDigit(text[i + 1])) {
      const zeroPadded = /^-?0\d*/.exec(text.slice(start))[0];
      this.fail('Numbers may not have leading zeros.', {
        code: 'leading-zero',
        hint: `Write "${String(Number(zeroPadded))}" instead of "${zeroPadded}".`,
        index: start,
        token: zeroPadded,
      });
    }

    if (isDigit(text[i])) {
      while (isDigit(text[i])) i += 1;
    } else if (text[i] === undefined) {
      this.fail('Unexpected end of input: a digit was expected after the minus sign.', {
        code: 'unexpected-eof',
        hint: 'Write a digit after the "-", for example -1.',
        index: start,
        token: '-',
      });
    } else {
      this.fail(`Unexpected ${describeChar(text[i])} — expected a digit.`, {
        code: 'invalid-number',
        hint: 'A JSON number is made of digits, an optional leading "-", a decimal point and an optional exponent, e.g. -12.5e3.',
        token: text[i],
      });
    }

    if (text[i] === '.') {
      i += 1;
      if (!isDigit(text[i])) {
        this.fail('A decimal point must be followed by at least one digit.', {
          code: 'invalid-number',
          hint: 'Write "1.0" instead of "1.".',
          index: i - 1,
          token: '.',
        });
      }
      while (isDigit(text[i])) i += 1;
    }

    if (text[i] === 'e' || text[i] === 'E') {
      i += 1;
      if (text[i] === '+' || text[i] === '-') i += 1;
      if (!isDigit(text[i])) {
        this.fail('The exponent of a number must contain at least one digit.', {
          code: 'invalid-number',
          hint: 'Valid examples: 1e10, 2.5E-3.',
          index: i,
          token: text.slice(start, i + 1),
        });
      }
      while (isDigit(text[i])) i += 1;
    }

    const raw = text.slice(start, i);
    const following = text[i];

    if (following !== undefined && /[A-Za-z0-9_$.]/.test(following)) {
      const tail = (/^[A-Za-z0-9_$.]+/.exec(text.slice(i)) ?? [''])[0];
      this.fail(`Invalid number "${raw}${tail}" — unexpected ${describeChar(following)} after the digits.`, {
        code: 'invalid-number',
        hint: 'A number may only contain digits, one leading "-", one decimal point and an optional exponent.',
        index: start,
        token: `${raw}${tail}`,
      });
    }

    this.pos = i;
    const value = Number(raw);

    if (!Number.isFinite(value)) {
      // Syntactically valid JSON: the literal just cannot be represented as a double.
      this.warn(
        'number-out-of-range',
        `The number ${raw} is larger than the biggest representable double. Reading it as a JavaScript number yields ${value}.`,
        start,
      );
    } else if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      this.warn(
        'precision-loss',
        `The integer ${raw} is larger than 2^53 - 1, so reading it as a JavaScript number silently loses precision.`,
        start,
      );
    }

    return { type: 'number', value, raw, start, end: i };
  }
}

/* -------------------------------------------------------------------------- */
/* value diagnosis (the "why is this invalid?" brain)                          */
/* -------------------------------------------------------------------------- */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const isIdentifierStart = (ch) => ch !== undefined && /[A-Za-z_$]/.test(ch);

/**
 * Explains an illegal character found where a JSON value was expected.
 * `rest` is the remainder of the document starting at that character.
 */
function diagnoseValueCharacter(ch, rest) {
  if (ch === "'") {
    return {
      code: 'single-quote',
      message: 'Single-quoted strings are not valid JSON.',
      hint: 'Use double quotes instead, for example: "value".',
      token: "'",
    };
  }
  if (isSmartQuote(ch)) {
    return {
      code: 'smart-quote',
      message: `Found a “curly” quote (${describeCodePoint(ch.codePointAt(0))}) where a straight double quote (") was expected.`,
      hint: 'Replace the curly quotes with plain ASCII quotes — word processors, chat apps and design tools insert them automatically.',
      token: ch,
    };
  }
  if (ch === '/' && (rest[1] === '/' || rest[1] === '*')) {
    const block = rest[1] === '*';
    return {
      code: 'comment',
      message: `Comments are not allowed in JSON${block ? ' (block comment “/* … */”)' : ' (line comment “// …”)'}.`,
      hint: 'Delete the comment, or store documentation next to the file. JSON has no comment syntax — only JSONC/JSON5 add one.',
      token: block ? '/*' : '//',
    };
  }
  if (ch === '}') {
    return {
      code: 'unmatched-bracket',
      message: "Unexpected '}' — there is no open '{' for it to close.",
      hint: 'Remove the extra brace, or add the object it was meant to close.',
      token: '}',
    };
  }
  if (ch === ']') {
    return {
      code: 'unmatched-bracket',
      message: "Unexpected ']' — there is no open '[' for it to close.",
      hint: 'Remove the extra bracket, or add the array it was meant to close.',
      token: ']',
    };
  }
  if (ch === ',') {
    return {
      code: 'unexpected-token',
      message: "Unexpected ',' — a value was expected before it.",
      hint: 'Remove the extra comma, or add the value it was meant to separate. Empty elements like [1, , 2] are not allowed.',
      token: ',',
    };
  }
  if (ch === ':') {
    return {
      code: 'unexpected-token',
      message: "Unexpected ':' — a value was expected here.",
      hint: 'A colon is only allowed between a property name and its value, for example: "id": 1.',
      token: ':',
    };
  }
  if (ch === '=') {
    return {
      code: 'unexpected-token',
      message: "Unexpected '=' — JSON uses a colon (':') between a name and its value.",
      hint: 'Write "name": "value" instead of name = "value".',
      token: '=',
    };
  }
  if (ch === 'N' && rest.startsWith('NaN')) {
    return {
      code: 'invalid-literal',
      message: 'NaN is not a valid JSON number.',
      hint: 'Use null, 0, or the string "NaN" if you need to keep that marker.',
      token: 'NaN',
    };
  }
  if (ch === 'I' && rest.startsWith('Infinity')) {
    return {
      code: 'invalid-literal',
      message: 'Infinity is not a valid JSON number.',
      hint: 'Use null, a finite number, or the string "Infinity".',
      token: 'Infinity',
    };
  }
  if (ch === 'u' && /^undefined\b/.test(rest)) {
    return {
      code: 'invalid-literal',
      message: 'undefined is not a valid JSON value.',
      hint: 'Use null instead of undefined, or drop the property entirely.',
      token: 'undefined',
    };
  }
  if (ch === '<') {
    return {
      code: 'wrong-format',
      message: "Unexpected '<' — this looks like XML or HTML, not JSON.",
      hint: 'Formatify only understands JSON. Convert the markup to JSON first (e.g. with an XML to JSON tool).',
      token: '<',
    };
  }
  if (isIdentifierStart(ch)) {
    const word = (/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest) ?? [''])[0];
    if (/^(true|false|null)$/i.test(word)) {
      return {
        code: 'invalid-literal',
        message: `Unexpected identifier "${word}" — JSON literals are written in lowercase.`,
        hint: `Write ${word.toLowerCase()} (all lowercase, without quotes) instead of "${word}".`,
        token: word,
      };
    }
    return {
      code: 'unquoted-value',
      message: `Unexpected identifier "${word}" — unquoted text is not a valid JSON value.`,
      hint: `String values must be wrapped in double quotes: "${word}". Only true, false and null may appear without quotes.`,
      token: word,
    };
  }
  return {
    code: 'unexpected-token',
    message: `Unexpected ${describeChar(ch)} — a JSON value was expected (object, array, string, number, true, false or null).`,
    hint:
      'Check for a stray character, a missing quote, or a missing comma on the line above — the real problem is often one line earlier.',
    token: ch,
  };
}

/* -------------------------------------------------------------------------- */
/* helpers + public API                                                       */
/* -------------------------------------------------------------------------- */

/** Converts the raw AST into plain JavaScript values. */
function materialize(node) {
  switch (node.type) {
    case 'object': {
      const out = {};
      for (const entry of node.entries) {
        // defineProperty keeps a key called "__proto__" from mutating the prototype
        Object.defineProperty(out, entry.key, {
          value: materialize(entry.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    case 'array':
      return node.items.map(materialize);
    default:
      return node.value;
  }
}

/** Counts nodes, depth and value types without materialising the document. */
export function summarizeNode(node) {
  const stats = {
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    keys: 0,
    total: 0,
    maxDepth: 0,
  };

  const walk = (current, depth) => {
    stats.total += 1;
    if (depth > stats.maxDepth) stats.maxDepth = depth;

    switch (current.type) {
      case 'object':
        stats.objects += 1;
        stats.keys += current.entries.length;
        for (const entry of current.entries) walk(entry.value, depth + 1);
        break;
      case 'array':
        stats.arrays += 1;
        for (const item of current.items) walk(item, depth + 1);
        break;
      case 'string':
        stats.strings += 1;
        break;
      case 'number':
        stats.numbers += 1;
        break;
      case 'boolean':
        stats.booleans += 1;
        break;
      default:
        stats.nulls += 1;
    }
  };

  walk(node, 1);
  return stats;
}

/**
 * Parses a JSON document.
 * @throws {JsonSyntaxError} when the document is invalid — the error carries
 *   `line`, `column`, `index`, `codeFrame` and a `hint`.
 */
export function parseJson(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('parseJson() expects a JSON string');
  }
  return new Parser(text, options).parseDocument();
}

/**
 * Never throws. Returns either
 *   { ok: true, value, node, warnings, stats, error: null }
 * or
 *   { ok: false, error, value: undefined, node: null, warnings: [], stats: null }
 */
export function validateJson(text, options = {}) {
  try {
    const { value, node, warnings } = parseJson(text, options);
    return { ok: true, value, node, warnings, stats: summarizeNode(node), error: null };
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return { ok: false, value: undefined, node: null, warnings: [], stats: null, error };
    }
    if (error instanceof RangeError) {
      return {
        ok: false,
        value: undefined,
        node: null,
        warnings: [],
        stats: null,
        error: new JsonSyntaxError({
          code: 'max-depth',
          message: 'The document is nested far too deeply to be parsed safely.',
          hint: 'Deeply nested JSON usually comes from a bug or a decompression bomb. Flatten it before formatting.',
          index: 0,
          line: 1,
          column: 1,
        }),
      };
    }
    throw error;
  }
}


