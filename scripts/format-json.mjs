#!/usr/bin/env node
/**
 * Formatify on the command line — the same engine the website uses.
 *
 *   node scripts/format-json.mjs data.json                 # beautify to stdout
 *   node scripts/format-json.mjs data.json --minify --write
 *   node scripts/format-json.mjs broken.json --fix --write
 *   cat data.json | node scripts/format-json.mjs --minify
 *
 * Exit codes: 0 = ok, 1 = invalid JSON, 2 = usage error.
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { beautifyJson, minifyJson } from '../src/formats/json/jsonFormatter.js';
import { JsonSyntaxError } from '../src/formats/json/jsonParser.js';
import { repairJson } from '../src/formats/json/jsonRepair.js';

function parseArguments(argv) {
  const options = { minify: false, sortKeys: false, indent: '2', fix: false, write: false };
  const files = [];

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    switch (argument) {
      case '--minify':
      case '-m':
        options.minify = true;
        break;
      case '--sort-keys':
        options.sortKeys = true;
        break;
      case '--fix':
        options.fix = true;
        break;
      case '--write':
      case '-w':
        options.write = true;
        break;
      case '--indent':
        options.indent = argv[i + 1] ?? '2';
        i += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (argument.startsWith('-')) {
          console.error(`Unknown option: ${argument}`);
          process.exit(2);
        }
        files.push(argument);
    }
  }

  return { options, files };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function reportError(error, fileName) {
  console.error(`\n✖ Invalid JSON in ${fileName} — ${error.location}`);
  console.error(`  ${error.message}`);
  if (error.hint) console.error(`  hint: ${error.hint}`);
  if (error.codeFrame) console.error(`\n${error.codeFrame}\n`);
  console.error(`  (error code: ${error.code})`);
}

const USAGE = `Usage: format-json [file] [options]

Options:
  -m, --minify        remove all whitespace instead of beautifying
      --indent <n>    2 (default), 4 or "tab"
      --sort-keys     sort object keys alphabetically
      --fix           repair common mistakes before formatting
  -w, --write         write the result back to the file
  -h, --help          show this help

Without a file the document is read from stdin.`;

async function main() {
  const { options, files } = parseArguments(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const fileName = files[0] ?? '<stdin>';
  const input = files[0] ? await readFile(files[0], 'utf8') : await readStdin();

  let source = input;
  if (options.fix) {
    const repaired = repairJson(source);
    if (repaired.changed) {
      source = repaired.text;
      for (const note of repaired.notes) console.error(`• ${note.message}`);
    }
  }

  const formatOptions = { indent: options.indent, sortKeys: options.sortKeys };
  const output = options.minify
    ? minifyJson(source, formatOptions)
    : beautifyJson(source, formatOptions);

  const result = `${output}\n`;
  if (options.write && files[0]) {
    await writeFile(files[0], result, 'utf8');
    console.error(`✔ ${fileName} formatted (${result.length} bytes)`);
  } else {
    process.stdout.write(result);
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof JsonSyntaxError) {
    reportError(error, process.argv[2] ?? '<stdin>');
    process.exitCode = 1;
  } else {
    console.error(error.message);
    process.exitCode = 2;
  }
}
