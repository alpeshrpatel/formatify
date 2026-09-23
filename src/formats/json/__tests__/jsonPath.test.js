import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { jsonPath } from '../jsonPath.js';

/** A canonical bookstore fixture — the shape used by most JSONPath examples. */
const store = {
  store: {
    book: [
      { title: 'A', price: 5, tags: ['cheap'] },
      { title: 'B', price: 15, tags: ['mid'] },
      { title: 'C', price: 25, tags: ['pricey'] },
    ],
    bicycle: { color: 'red', price: 20 },
  },
};

/* -------------------------------------------------------------------------- */
/* root and child access                                                       */
/* -------------------------------------------------------------------------- */

describe('jsonPath — root and children', () => {
  test('$ returns the whole document', () => {
    assert.deepEqual(jsonPath(store, '$'), [store]);
  });

  test('reads a nested child by dotted key', () => {
    assert.deepEqual(jsonPath(store, '$.store.bicycle.color'), ['red']);
  });

  test('reads a child in a bracket-quoted key', () => {
    assert.deepEqual(jsonPath(store, "$.store['bicycle'].color"), ['red']);
    assert.deepEqual(jsonPath(store, '$.store["bicycle"].color'), ['red']);
  });

  test('returns an empty list for a missing path', () => {
    assert.deepEqual(jsonPath(store, '$.store.nothing.here'), []);
  });

  test('tolerates surrounding whitespace', () => {
    assert.deepEqual(jsonPath(store, '  $.store.bicycle.color  '), ['red']);
  });
});

/* -------------------------------------------------------------------------- */
/* arrays                                                                      */
/* -------------------------------------------------------------------------- */

describe('jsonPath — arrays', () => {
  test('indexes into an array', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[0].title'), ['A']);
    assert.deepEqual(jsonPath(store, '$.store.book[2].title'), ['C']);
  });

  test('supports negative indexes', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[-1].title'), ['C']);
  });

  test('returns nothing when indexing a non-array', () => {
    assert.deepEqual(jsonPath(store, '$.store.bicycle[0]'), []);
  });

  test('wildcards every element of an array', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[*].title'), ['A', 'B', 'C']);
  });

  test('slices arrays', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[0:2].title'), ['A', 'B']);
    assert.deepEqual(jsonPath(store, '$.store.book[1:].title'), ['B', 'C']);
    assert.deepEqual(jsonPath(store, '$.store.book[:2].title'), ['A', 'B']);
  });

  test('chains wildcards through nested arrays', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[*].tags[*]'), ['cheap', 'mid', 'pricey']);
  });

  test('treats an array root as selectable', () => {
    assert.deepEqual(jsonPath([1, 2, 3], '$[*]'), [1, 2, 3]);
    assert.deepEqual(jsonPath([1, 2, 3], '$[1]'), [2]);
  });
});


/* -------------------------------------------------------------------------- */
/* wildcards on objects                                                        */
/* -------------------------------------------------------------------------- */

describe('jsonPath — object wildcards', () => {
  test('.* yields every value of an object', () => {
    assert.deepEqual(jsonPath({ a: 1, b: 2 }, '$.*'), [1, 2]);
  });

  test('[*] yields every value of an object', () => {
    assert.deepEqual(jsonPath({ a: 1, b: 2 }, '$[*]'), [1, 2]);
  });

  test('wildcard results keep insertion order', () => {
    assert.deepEqual(jsonPath({ z: 1, a: 2, m: 3 }, '$.*'), [1, 2, 3]);
  });

  test('wildcards compose with a following child step', () => {
    assert.deepEqual(jsonPath(store, '$.store.*.color'), ['red']);
  });

  test('returns nothing when wildcarding a scalar', () => {
    assert.deepEqual(jsonPath({ a: 1 }, '$.a.*'), []);
  });
});

/* -------------------------------------------------------------------------- */
/* recursive descent                                                           */
/* -------------------------------------------------------------------------- */

describe('jsonPath — recursive descent', () => {
  test('..key collects the key at every depth', () => {
    assert.deepEqual(jsonPath(store, '$..price'), [5, 15, 25, 20]);
  });

  test('..key descends through arrays', () => {
    assert.deepEqual(jsonPath(store, '$..title'), ['A', 'B', 'C']);
  });

  test('..key matches at the root too', () => {
    assert.deepEqual(jsonPath({ title: 'root', child: { title: 'leaf' } }, '$..title'), ['root', 'leaf']);
  });

  test('..key yields nothing when absent everywhere', () => {
    assert.deepEqual(jsonPath(store, '$..nope'), []);
  });
});


/* -------------------------------------------------------------------------- */
/* filters                                                                     */
/* -------------------------------------------------------------------------- */

describe('jsonPath — filters', () => {
  test('filters with < and >', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price < 10)].title'), ['A']);
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price > 10)].title'), ['B', 'C']);
  });

  test('filters with <= and >=', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price <= 5)].title'), ['A']);
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price >= 25)].title'), ['C']);
  });

  test('filters with == on strings', () => {
    assert.deepEqual(jsonPath(store, "$.store.book[?(@.title == 'B')].price"), [15]);
  });

  test('filters with != on strings', () => {
    assert.deepEqual(jsonPath(store, "$.store.book[?(@.title != 'B')].title"), ['A', 'C']);
  });

  test('combines predicates with && and ||', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price > 1 && @.price < 20)].title'), ['A', 'B']);
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price < 6 || @.price > 20)].title'), ['A', 'C']);
  });

  test('honours explicit parentheses in filters', () => {
    assert.deepEqual(
      jsonPath(store, "$.store.book[?((@.price < 6 || @.price > 20) && @.title != 'C')].title"),
      ['A'],
    );
  });

  test('returns an empty list when nothing matches', () => {
    assert.deepEqual(jsonPath(store, '$.store.book[?(@.price > 1000)]'), []);
  });

  test('returns the matching objects when no trailing step is given', () => {
    const hits = jsonPath(store, '$.store.book[?(@.price == 15)]');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'B');
  });

  test('rejects a filter on a non-array', () => {
    assert.deepEqual(jsonPath(store, '$.store.bicycle[?(@.price > 1)]'), []);
  });

  test('supports a bare @ existence filter', () => {
    assert.deepEqual(jsonPath({ a: [1, 2, 3] }, '$.a[?(@ > 1)]'), [2, 3]);
  });
});


/* -------------------------------------------------------------------------- */
/* robustness                                                                  */
/* -------------------------------------------------------------------------- */

describe('jsonPath — robustness', () => {
  test('an empty or blank expression yields nothing', () => {
    assert.deepEqual(jsonPath(store, ''), []);
    assert.deepEqual(jsonPath(store, '   '), []);
  });

  test('querying null or undefined yields nothing', () => {
    assert.deepEqual(jsonPath(null, '$.a'), []);
    assert.deepEqual(jsonPath(undefined, '$.a'), []);
  });

  test('throws a readable error on a malformed expression', () => {
    assert.throws(() => jsonPath(store, '$.store.book['), /Empty subscript|Unbalanced/);
    assert.throws(() => jsonPath(store, '$.store.book[?(@.price <)]'), /Unexpected end|Unexpected token/);
    assert.throws(() => jsonPath(store, '??'), /Unexpected character/);
  });

  test('reports unbalanced filter parentheses', () => {
    assert.throws(() => jsonPath(store, '$.store.book[?(@.price]'), /Unbalanced parentheses/);
  });

  test('reports an unterminated string literal', () => {
    assert.throws(() => jsonPath(store, "$.store['bicycle"), /Unterminated string/);
  });

  test('reports a dangling dot', () => {
    assert.throws(() => jsonPath(store, '$.store.'), /Expected a property name/);
  });

  test('is safe on cyclic structures', () => {
    const cyclic = { name: 'root' };
    cyclic.self = cyclic;
    assert.deepEqual(jsonPath(cyclic, '$..name'), ['root']);
  });

  test('does not treat inherited Object.prototype keys as present', () => {
    assert.deepEqual(jsonPath({}, '$.constructor'), []);
    assert.deepEqual(jsonPath({}, '$.toString'), []);
  });

  test('does not mutate the queried document', () => {
    const original = JSON.parse(JSON.stringify(store));
    jsonPath(store, '$..price');
    jsonPath(store, '$.store.book[?(@.price > 1)]');
    assert.deepEqual(store, original);
  });
});
