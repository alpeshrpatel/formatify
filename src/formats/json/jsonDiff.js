/** jsonDiff.js — lightweight line-oriented diff for the JSON Diff Viewer. */

/**
 * Compute a line-oriented diff between two strings.
 * Returns an array of diff ops, each tagged 'equ', 'add' or 'del'.
 *
 * Walks the longest common subsequence of the two line arrays: every line
 * before the next common line is a deletion on the left or an addition on the
 * right, and each common line is emitted as 'equ'. Anything left over after
 * the LCS is exhausted is a trailing run of deletions then additions.
 */
export function diffLines(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const lcs = buildLcs(aLines, bLines);
  const ops = [];
  let i = 0;
  let j = 0;

  for (const common of lcs) {
    while (i < aLines.length && aLines[i] !== common) {
      ops.push({ kind: 'del', line: aLines[i] });
      i += 1;
    }
    while (j < bLines.length && bLines[j] !== common) {
      ops.push({ kind: 'add', line: bLines[j] });
      j += 1;
    }
    if (i < aLines.length) {
      ops.push({ kind: 'equ', line: common });
      i += 1;
    }
    if (j < bLines.length) j += 1;
  }

  while (i < aLines.length) {
    ops.push({ kind: 'del', line: aLines[i] });
    i += 1;
  }
  while (j < bLines.length) {
    ops.push({ kind: 'add', line: bLines[j] });
    j += 1;
  }

  return ops;
}

/**
 * Build the longest common subsequence of two string arrays.
 * O(m*n) time, O(min(m,n)) space via the Hirschberg-inspired DP.
 */
function buildLcs(a, b) {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = length of LCS of a[0..i-1] and b[0..j-1]
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i += 1) {
    const ai = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      if (ai === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // Backtrack to produce the LCS.
  const lcs = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.push(a[i - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  lcs.reverse();
  return lcs;
}

/**
 * Compute a structural diff between two parsed JSON values.
 * Returns a list of change descriptors: { path, kind, old?, new? }.
 * kind is one of: 'added', 'removed', 'changed', 'nested'.
 */
export function diffValues(a, b, path = '$') {
  const changes = [];
  if (a === b) return changes;

  if (a === null || b === null || typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    changes.push({ path, kind: 'changed', old: a, new: b });
    return changes;
  }

  if (typeof a === 'object') {
    const aKeys = Array.isArray(a) ? a.map((_, i) => i) : Object.keys(a);
    const bKeys = Array.isArray(b) ? b.map((_, i) => i) : Object.keys(b);
    const bKeySet = new Set(bKeys);

    for (const key of aKeys) {
      const childPath = path + '[' + JSON.stringify(key) + ']';
      if (!bKeySet.has(key)) {
        changes.push({ path: childPath, kind: 'removed', old: a[key] });
      } else {
        changes.push(...diffValues(a[key], b[key], childPath));
      }
    }
    for (const key of bKeys) {
      if (!aKeys.includes(key)) {
        changes.push({ path: path + '[' + JSON.stringify(key) + ']', kind: 'added', new: b[key] });
      }
    }
  } else {
    changes.push({ path, kind: 'changed', old: a, new: b });
  }
  return changes;
}
