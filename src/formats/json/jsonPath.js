/** jsonPath.js — a small, dependency-free JSONPath query engine.

    Supported syntax:
      $                      the root document
      .key  /  ['key']       a child by name (single or double quotes)
      [0]  /  [-1]           an array index (negative counts from the end)
      [0:2] / [1:] / [:2]    an array slice
      [*]  /  .*             every child (array element or object value)
      [?(<expr>)]            a filter over an array
      ..key                  recursive descent to every matching key

    Filter expressions read `@` as the current item and accept:
      == != < <= > >=        comparisons
      &&  ||                 boolean combination
      ( )                    grouping
      'text' "text" 1 true   literals

    A malformed expression throws an Error with a readable message so callers
    (e.g. JsonPathPanel) can show the problem instead of a wrong answer.
*/

const KEY_CHARS = /[A-Za-z0-9_]/;
const WORD_HEAD = /[A-Za-z_]/;
const NUMBER_CHARS = /[-\d.]/;
const SUBSCRIPT_CHARS = /[\d-:]/;
const COMPARATORS = new Set(['EQ', 'NE', 'LT', 'GT', 'LE', 'GE']);

/* -------------------------------------------------------------------------- */
/* lexer                                                                       */
/* -------------------------------------------------------------------------- */

/** Turn an expression into a flat token list. Throws on an unterminated part. */
function lex(expr) {
  const tokens = [];
  let i = 0;

  const at = (offset = 0) => expr[i + offset];

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch === '$') { tokens.push({ k: 'DOLLAR' }); i += 1; continue; }
    if (ch === '@') { tokens.push({ k: 'AT' }); i += 1; continue; }
    if (ch === '.' && at(1) === '.') { tokens.push({ k: 'RECURSE' }); i += 2; continue; }
    if (ch === '.' && at(1) === '*') { tokens.push({ k: 'WILD' }); i += 2; continue; }
    if (ch === '.') {
      i += 1;
      let key = '';
      while (i < expr.length && KEY_CHARS.test(expr[i])) { key += expr[i]; i += 1; }
      if (key === '') throw new Error('Expected a property name after ".".');
      tokens.push({ k: 'KEY', v: key });
      continue;
    }
    if (ch === '[') {
      i = lexSubscript(expr, i, tokens);
      continue;
    }
    if (ch === '<' && at(1) === '=') { tokens.push({ k: 'LE' }); i += 2; continue; }
    if (ch === '>' && at(1) === '=') { tokens.push({ k: 'GE' }); i += 2; continue; }
    if (ch === '<') { tokens.push({ k: 'LT' }); i += 1; continue; }
    if (ch === '>') { tokens.push({ k: 'GT' }); i += 1; continue; }
    if (ch === '=' && at(1) === '=') { tokens.push({ k: 'EQ' }); i += 2; continue; }
    if (ch === '!' && at(1) === '=') { tokens.push({ k: 'NE' }); i += 2; continue; }
    if (ch === '&' && at(1) === '&') { tokens.push({ k: 'AND' }); i += 2; continue; }
    if (ch === '|' && at(1) === '|') { tokens.push({ k: 'OR' }); i += 2; continue; }
    if (ch === '(') { tokens.push({ k: 'LPAREN' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ k: 'RPAREN' }); i += 1; continue; }
    if (ch === "'" || ch === '"') {
      const quoted = readString(expr, i);
      tokens.push({ k: 'STRING', v: quoted.value });
      i = quoted.next;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(at(1) || ''))) {
      let text = '';
      while (i < expr.length && NUMBER_CHARS.test(expr[i])) { text += expr[i]; i += 1; }
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`Invalid number "${text}" in the expression.`);
      tokens.push({ k: 'NUMBER', v: value });
      continue;
    }
    if (WORD_HEAD.test(ch)) {
      let word = '';
      while (i < expr.length && KEY_CHARS.test(expr[i])) { word += expr[i]; i += 1; }
      if (word === 'true') tokens.push({ k: 'BOOL', v: true });
      else if (word === 'false') tokens.push({ k: 'BOOL', v: false });
      else if (word === 'null') tokens.push({ k: 'NULL' });
      else tokens.push({ k: 'ID', v: word });
      continue;
    }

    throw new Error(`Unexpected character "${ch}" in the expression.`);
  }

  return tokens;
}

/** Read a quoted string. Returns the unescaped value and the next index. */
function readString(expr, start) {
  const quote = expr[start];
  let i = start + 1;
  let value = '';
  while (i < expr.length && expr[i] !== quote) {
    if (expr[i] === '\\' && i + 1 < expr.length) i += 1;
    value += expr[i];
    i += 1;
  }
  if (i >= expr.length) throw new Error('Unterminated string literal in the expression.');
  return { value, next: i + 1 };
}

/**
 * Lex everything from the "[" at `start` through its matching "]".
 * Returns the index just past the closing bracket.
 */
function lexSubscript(expr, start, tokens) {
  let i = start + 1;

  if (expr[i] === '?') {
    const filter = readFilterBody(expr, i + 1);
    tokens.push({ k: 'FILTER', v: filter.text });
    return expectBracketClose(expr, filter.next);
  }
  if (expr[i] === '*') {
    tokens.push({ k: 'WILD' });
    return expectBracketClose(expr, i + 1);
  }
  if (expr[i] === "'" || expr[i] === '"') {
    const quoted = readString(expr, i);
    tokens.push({ k: 'KEY', v: quoted.value });
    return expectBracketClose(expr, quoted.next);
  }

  let text = '';
  while (i < expr.length && SUBSCRIPT_CHARS.test(expr[i])) { text += expr[i]; i += 1; }
  if (text === '') throw new Error('Empty subscript "[]" in the expression.');

  const parts = text.split(':').map((part) => (part === '' ? undefined : Number(part)));
  if (parts.some((part) => typeof part === 'number' && !Number.isFinite(part))) {
    throw new Error(`Invalid subscript "[${text}]".`);
  }
  if (parts.length > 2) throw new Error(`Invalid slice "[${text}]" — a slice takes at most two bounds.`);
  tokens.push(parts.length === 1 ? { k: 'INDEX', v: parts[0] } : { k: 'SLICE', v: parts });
  return expectBracketClose(expr, i);
}

/** Require a "]" at `i`, returning the index just after it. */
function expectBracketClose(expr, i) {
  if (expr[i] !== ']') throw new Error('Expected "]" to close a subscript.');
  return i + 1;
}

/**
 * Read the body of a `?( ... )` filter, tracking nested parentheses.
 * Returns the inner source text and the index just past the ")".
 */
function readFilterBody(expr, start) {
  if (expr[start] !== '(') throw new Error('A filter must be written as "?( ... )".');
  let depth = 1;
  let i = start + 1;
  while (i < expr.length && depth > 0) {
    if (expr[i] === '(') depth += 1;
    else if (expr[i] === ')') depth -= 1;
    i += 1;
  }
  if (depth > 0) throw new Error('Unbalanced parentheses in a filter.');
  return { text: expr.slice(start + 1, i - 1), next: i };
}

/* -------------------------------------------------------------------------- */
/* filter expressions                                                          */
/* -------------------------------------------------------------------------- */

/** A KEY or a bare ID token both name a property. */
function isNameToken(token) {
  return Boolean(token) && (token.k === 'KEY' || token.k === 'ID');
}

/**
 * Parse a filter body such as `@.price < 10 && @.title != 'x'` into an AST.
 * Every token must be consumed, so trailing junk is reported as an error
 * rather than silently ignored.
 */
function parseFilter(source) {
  const tokens = lex(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().k === 'OR') {
      advance();
      left = { t: 'or', l: left, r: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseComparison();
    while (peek() && peek().k === 'AND') {
      advance();
      left = { t: 'and', l: left, r: parseComparison() };
    }
    return left;
  }

  function parseComparison() {
    const left = parseOperand();
    const op = peek();
    if (!op || !COMPARATORS.has(op.k)) return left;
    advance();
    return { t: 'cmp', op: op.k, l: left, r: parseOperand() };
  }

  function parseOperand() {
    const token = peek();
    if (!token) throw new Error('Unexpected end of filter expression.');

    if (token.k === 'LPAREN') {
      advance();
      const inner = parseOr();
      if (!peek() || peek().k !== 'RPAREN') throw new Error('Missing ")" in the filter.');
      advance();
      return inner;
    }
    if (token.k === 'AT') {
      advance();
      const next = peek();
      if (next && next.k === 'KEY') { advance(); return { t: 'atKey', k: next.v }; }
      if (next && next.k === 'INDEX') { advance(); return { t: 'atIndex', i: next.v }; }
      return { t: 'at' };
    }
    if (token.k === 'ID') {
      advance();
      if (peek() && peek().k === 'LPAREN') {
        advance();
        const arg = parseOr();
        if (!peek() || peek().k !== 'RPAREN') throw new Error('Missing ")" after a filter function.');
        advance();
        return { t: 'func', name: token.v, arg };
      }
      if (token.v === 'length') return { t: 'length' };
      if (token.v === 'root') return { t: 'root' };
      return { t: 'id', name: token.v };
    }
    if (token.k === 'STRING' || token.k === 'NUMBER' || token.k === 'BOOL') {
      advance();
      return { t: 'val', v: token.v };
    }
    if (token.k === 'NULL') {
      advance();
      return { t: 'val', v: null };
    }

    throw new Error(`Unexpected token "${token.k}" in the filter.`);
  }

  const ast = parseOr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token "${tokens[pos].k}" in the filter.`);
  }
  return ast;
}

/** Read a property from a value, but never from Object.prototype. */
function ownValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return /^\d+$/.test(key) ? value[Number(key)] : undefined;
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

/** Evaluate a filter AST against the current array element. */
function evaluateFilter(ast, current, root) {
  switch (ast.t) {
    case 'val': return ast.v;
    case 'root': return root;
    case 'at': return current;
    case 'atKey': return ownValue(current, ast.k);
    case 'atIndex': return Array.isArray(current) ? current[ast.i] : undefined;
    case 'length': {
      if (Array.isArray(current)) return current.length;
      if (current && typeof current === 'object') return Object.keys(current).length;
      if (typeof current === 'string') return current.length;
      return undefined;
    }
    case 'id': return undefined;
    case 'func': {
      const arg = evaluateFilter(ast.arg, current, root);
      if (ast.name === 'length') {
        if (Array.isArray(arg)) return arg.length;
        if (arg && typeof arg === 'object') return Object.keys(arg).length;
        if (typeof arg === 'string') return arg.length;
      }
      return undefined;
    }
    case 'cmp': {
      const left = evaluateFilter(ast.l, current, root);
      const right = evaluateFilter(ast.r, current, root);
      if (left === undefined || right === undefined) return false;
      switch (ast.op) {
        case 'EQ': return left === right;
        case 'NE': return left !== right;
        case 'LT': return left < right;
        case 'GT': return left > right;
        case 'LE': return left <= right;
        case 'GE': return left >= right;
        default: return false;
      }
    }
    case 'and': return Boolean(evaluateFilter(ast.l, current, root)) && Boolean(evaluateFilter(ast.r, current, root));
    case 'or': return Boolean(evaluateFilter(ast.l, current, root)) || Boolean(evaluateFilter(ast.r, current, root));
    default: return false;
  }
}


/* -------------------------------------------------------------------------- */
/* query parsing                                                               */
/* -------------------------------------------------------------------------- */

/** Turn a token stream into the ordered list of steps to apply. */
function parseQuery(tokens) {
  const steps = [];
  let pos = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];

  while (peek()) {
    const token = peek();

    if (token.k === 'DOLLAR') {
      advance();
      const next = peek();
      if (isNameToken(next)) { advance(); steps.push({ type: 'child', key: next.v }); }
      else if (next && next.k === 'WILD') { advance(); steps.push({ type: 'wild' }); }
      else if (next && (next.k === 'INDEX' || next.k === 'SLICE')) { /* handled by the next iteration */ }
      else steps.push({ type: 'root' });
      continue;
    }
    if (isNameToken(token)) {
      advance();
      steps.push({ type: 'child', key: token.v });
      continue;
    }
    if (token.k === 'RECURSE') {
      advance();
      const next = peek();
      if (isNameToken(next)) { advance(); steps.push({ type: 'deep', key: next.v }); }
      else if (next && next.k === 'WILD') { advance(); steps.push({ type: 'deepAll' }); }
      else throw new Error('Recursive descent ".." needs a property name or "*", e.g. "$..title".');
      continue;
    }
    if (token.k === 'FILTER') {
      advance();
      steps.push({ type: 'filter', ast: parseFilter(token.v) });
      continue;
    }
    if (token.k === 'WILD') {
      advance();
      steps.push({ type: 'wild' });
      continue;
    }
    if (token.k === 'INDEX') {
      advance();
      steps.push({ type: 'index', index: token.v });
      continue;
    }
    if (token.k === 'SLICE') {
      advance();
      steps.push({ type: 'slice', start: token.v[0], end: token.v[1] });
      continue;
    }

    throw new Error(`Unexpected token "${token.k}" in the expression.`);
  }

  return steps;
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/** Apply one step to one value, returning every matching child. */
function applyStep(current, step, root) {
  switch (step.type) {
    case 'child': {
      const value = ownValue(current, step.key);
      return value === undefined ? [] : [value];
    }
    case 'wild': {
      if (Array.isArray(current)) return current;
      if (current && typeof current === 'object') return Object.values(current);
      return [];
    }
    case 'index': {
      if (!Array.isArray(current)) return [];
      const raw = Array.isArray(step.index) ? step.index[0] : step.index;
      const at = raw < 0 ? current.length + raw : raw;
      return at >= 0 && at < current.length ? [current[at]] : [];
    }
    case 'slice': {
      if (!Array.isArray(current)) return [];
      const start = step.start === undefined ? 0 : step.start;
      const end = step.end === undefined ? current.length : step.end;
      return current.slice(start, end);
    }
    case 'filter': {
      if (!Array.isArray(current)) return [];
      return current.filter((item) => evaluateFilter(step.ast, item, root));
    }
    case 'deep': {
      const out = [];
      const seen = new WeakSet();
      (function walk(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        const hit = ownValue(node, step.key);
        if (hit !== undefined) out.push(hit);
        for (const key of Object.keys(node)) walk(node[key]);
      })(current);
      return out;
    }
    case 'deepAll': {
      const out = [];
      const seen = new WeakSet();
      (function walk(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
          for (const item of node) { out.push(item); walk(item); }
          return;
        }
        for (const key of Object.keys(node)) { out.push(node[key]); walk(node[key]); }
      })(current);
      return out;
    }
    case 'root':
      return [current];
    default:
      return [];
  }
}

/**
 * Query a parsed JSON value with a JSONPath expression.
 * Returns an array of matches — empty when nothing matches.
 * Throws an Error when the expression itself is malformed.
 */
export function jsonPath(data, expr) {
  if (data === null || data === undefined) return [];
  const source = typeof expr === 'string' ? expr.trim() : '';
  if (source === '') return [];

  const tokens = lex(source);
  if (tokens.length === 0) return [];

  const steps = parseQuery(tokens);
  let results = [data];
  for (const step of steps) {
    const next = [];
    for (const current of results) next.push(...applyStep(current, step, data));
    results = next;
  }
  return results;
}

export { lex, parseQuery, applyStep, parseFilter, evaluateFilter };

