import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

/**
 * Minimal CSS structure scanner: tracks comment/string-aware block nesting
 * and reports any rule that opens while still inside an unclosed plain rule
 * (the signature of a missing `}` swallowing everything below it), any stray
 * top-level declaration, and any block left open at EOF.
 */
function scanProblems(source) {
  const problems = [];
  const stack = []; // { isAtRule, selector, line }
  let pre = ''; // text since the last `;`, `{` or `}`
  let inComment = false;
  let line = 1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\n') line += 1;

    if (inComment) {
      if (ch === '*' && source[i + 1] === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '\n') line += 1;
        if (source[i] === '\\') {
          i += 1;
          continue;
        }
        if (source[i] === quote) break;
      }
      continue;
    }
    if (ch === '{') {
      const selector = pre.trim();
      const isAtRule = selector.startsWith('@');
      const parent = stack[stack.length - 1];
      if (!isAtRule && parent && !parent.isAtRule) {
        problems.push(
          `line ${line}: rule "${selector.slice(0, 60)}" opens inside unclosed rule ` +
            `"${parent.selector.slice(0, 60)}" (line ${parent.line})`,
        );
      }
      stack.push({ isAtRule, selector, line });
      pre = '';
      continue;
    }
    if (ch === '}') {
      if (stack.length === 0) {
        problems.push(`line ${line}: "}" with no matching rule`);
      } else {
        stack.pop();
      }
      pre = '';
      continue;
    }
    if (ch === ';') {
      if (stack.length === 0 && pre.trim()) {
        problems.push(`line ${line}: top-level declaration "${pre.trim().slice(0, 60)}"`);
      }
      pre = '';
      continue;
    }
    pre += ch;
  }

  for (const open of stack) {
    problems.push(`line ${open.line}: rule "${open.selector.slice(0, 60)}" is never closed`);
  }
  if (pre.trim()) problems.push(`trailing content outside any rule: "${pre.trim().slice(0, 60)}"`);
  return problems;
}

describe('styles.css — structural integrity', () => {
  test('no rule is swallowed by an unclosed rule above it', () => {
    assert.deepEqual(scanProblems(css), []);
  });
});