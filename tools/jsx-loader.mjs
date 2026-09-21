/**
 * A tiny JSX/ESM loader for `node --test`.
 *
 * Node cannot read `.jsx` on its own; esbuild (already a Vite dependency) does
 * the transform in-process, so the UI tests need no extra tooling.
 */
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const source = await readFile(new URL(url), 'utf8');
    const { code } = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      target: 'node20',
      sourcefile: url,
      sourcemap: 'inline',
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
