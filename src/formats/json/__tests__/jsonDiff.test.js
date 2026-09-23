import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { diffLines, diffValues } from '../jsonDiff.js';

/* -------------------------------------------------------------------------- */
/* line diff                                                                   */
/* -------------------------------------------------------------------------- */

describe('diffLines', () => {
  test('marks every line as unchanged for identical input', () => {
    const ops = diffLines('a\nb', 'a\nb');
    assert.deepEqual(ops, [
      { kind: 'equ', line: 'a' },
      { kind: 'equ', line: 'b' },
    ]);
  });

  test('reports a single changed line as a delete plus an add', () => {
    assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc'), [
      { kind: 'equ', line: 'a' },
      { kind: 'del', line: 'b' },
      { kind: 'add', line: 'x' },
      { kind: 'equ', line: 'c' },
    ]);
  });

  test('reports a pure insertion', () => {
    assert.deepEqual(diffLines('a\nc', 'a\nb\nc'), [
      { kind: 'equ', line: 'a' },
      { kind: 'add', line: 'b' },
      { kind: 'equ', line: 'c' },
    ]);
  });

  test('reports a pure deletion', () => {
    assert.deepEqual(diffLines('a\nb\nc', 'a\nc'), [
      { kind: 'equ', line: 'a' },
      { kind: 'del', line: 'b' },
      { kind: 'equ', line: 'c' },
    ]);
  });

  test('handles an empty left side', () => {
    const ops = diffLines('', 'a');
    assert.ok(ops.some((op) => op.kind === 'add' && op.line === 'a'));
  });

  test('handles an empty right side', () => {
    const ops = diffLines('a', '');
    assert.ok(ops.some((op) => op.kind === 'del' && op.line === 'a'));
  });

  test('handles two empty inputs', () => {
    assert.deepEqual(diffLines('', ''), [{ kind: 'equ', line: '' }]);
  });

  test('reconstructing from the ops yields the right-hand side', () => {
    const a = 'one\ntwo\nthree\nfour';
    const b = 'one\nTWO\nfour\nfive';
    const rebuilt = diffLines(a, b)
      .filter((op) => op.kind !== 'del')
      .map((op) => op.line)
      .join('\n');
    assert.equal(rebuilt, b);
  });

  test('reconstructing the deletions yields the left-hand side', () => {
    const a = 'one\ntwo\nthree\nfour';
    const b = 'one\nTWO\nfour\nfive';
    const rebuilt = diffLines(a, b)
      .filter((op) => op.kind !== 'add')
      .map((op) => op.line)
      .join('\n');
    assert.equal(rebuilt, a);
  });

  test('every op carries one of the three known kinds', () => {
    const ops = diffLines('a\nb\nc\nd', 'a\nc\nx\nd');
    for (const op of ops) assert.ok(['equ', 'add', 'del'].includes(op.kind));
  });
});


/* -------------------------------------------------------------------------- */
/* structural diff                                                             */
/* -------------------------------------------------------------------------- */

describe('diffValues', () => {
  test('reports no changes for equal objects', () => {
    assert.deepEqual(diffValues({ a: 1 }, { a: 1 }), []);
  });

  test('reports no changes for equal arrays', () => {
    assert.deepEqual(diffValues([1, 2], [1, 2]), []);
  });

  test('reports no changes for equal primitives', () => {
    assert.deepEqual(diffValues('x', 'x'), []);
    assert.deepEqual(diffValues(null, null), []);
  });

  test('reports a changed scalar with old and new values', () => {
    assert.deepEqual(diffValues({ a: 1, b: 2 }, { a: 1, b: 3 }), [
      { path: '$["b"]', kind: 'changed', old: 2, new: 3 },
    ]);
  });

  test('reports an added key', () => {
    assert.deepEqual(diffValues({ a: 1 }, { a: 1, b: 2 }), [
      { path: '$["b"]', kind: 'added', new: 2 },
    ]);
  });

  test('reports a removed key', () => {
    assert.deepEqual(diffValues({ a: 1, b: 2 }, { a: 1 }), [
      { path: '$["b"]', kind: 'removed', old: 2 },
    ]);
  });

  test('walks nested objects and reports the full path', () => {
    assert.deepEqual(diffValues({ a: { b: 1 } }, { a: { b: 2 } }), [
      { path: '$["a"]["b"]', kind: 'changed', old: 1, new: 2 },
    ]);
  });

  test('indexes array positions in the path', () => {
    assert.deepEqual(diffValues([1, 2], [1, 3]), [
      { path: '$[1]', kind: 'changed', old: 2, new: 3 },
    ]);
  });

  test('treats a type change as a single change at the root', () => {
    assert.deepEqual(diffValues('1', 1), [{ path: '$', kind: 'changed', old: '1', new: 1 }]);
  });

  test('treats an array-to-object change as a change', () => {
    const changes = diffValues({ a: [1] }, { a: { 0: 1 } });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'changed');
    assert.equal(changes[0].path, '$["a"]');
  });

  test('treats null against an object as a change', () => {
    const changes = diffValues({ a: null }, { a: { b: 1 } });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'changed');
  });

  test('reports several changes in one pass', () => {
    const changes = diffValues({ a: 1, b: 2 }, { a: 9, c: 3 });
    const kinds = changes.map((c) => `${c.path}:${c.kind}`).sort();
    assert.deepEqual(kinds, ['$["a"]:changed', '$["b"]:removed', '$["c"]:added']);
  });

  test('compares deeply nested arrays of objects', () => {
    const before = { rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };
    const after = { rows: [{ id: 1, name: 'a' }, { id: 2, name: 'B' }] };
    assert.deepEqual(diffValues(before, after), [
      { path: '$["rows"][1]["name"]', kind: 'changed', old: 'b', new: 'B' },
    ]);
  });

  test('honours a custom root path label', () => {
    const changes = diffValues({ a: 1 }, { a: 2 }, 'doc');
    assert.equal(changes[0].path, 'doc["a"]');
  });

  test('does not mutate either input', () => {
    const before = { a: { b: [1, 2] } };
    const after = { a: { b: [1, 3] } };
    const snapshotBefore = JSON.parse(JSON.stringify(before));
    const snapshotAfter = JSON.parse(JSON.stringify(after));
    diffValues(before, after);
    assert.deepEqual(before, snapshotBefore);
    assert.deepEqual(after, snapshotAfter);
  });
});
