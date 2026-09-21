# Formatify — JSON beautifier, validator & binary data inspector

A beautiful, dependency-light React app that beautifies, minifies and validates JSON — and when
something is wrong it tells you **exactly** where and why. It also reads **Apache Parquet** and
**Apache Avro** files: schema, metadata and a searchable row preview, entirely in the browser.


```
✖ Invalid JSON — Line 4, column 1
  Trailing comma before "}" is not allowed.
  hint: Remove the comma that follows the last property — the object must end with: "lastKey": value }

    2 |   "b": 1,
    3 |   "a": 2,
  > 4 | }
      | ^
```

## Why not just `JSON.parse`?

`JSON.parse` throws short, engine-specific messages and never tells you *why* a document is
invalid. Formatify ships its own RFC 8259 parser (`src/formats/json/jsonParser.js`) that reports:

| Reported                  | Example                                                    |
| ------------------------- | ---------------------------------------------------------- |
| Exact line **and** column | `Line 3, column 1`                                         |
| Error code                | `trailing-comma`                                           |
| Human explanation         | `Trailing comma before "}" is not allowed.`                |
| How to fix it (hint)      | `Remove the comma that follows the last property …`        |
| A code frame with caret   | `> 4 \| }` plus `^`                                        |
| Character index, snippet  | `character 42`, plus the offending line for inline marks   |

The diagnostics cover the mistakes people actually make: trailing commas, missing commas,
unquoted keys, single quotes, curly/smart quotes, `//` and `/* */` comments, `NaN`/`Infinity`/
`undefined`, capitalized literals (`True`), leading zeros, `+1`, `.5`, `1.`, `1e`, bad `\uXXXX`
escapes, JavaScript escapes (`\x41`, `\0`), unterminated strings/objects/arrays, mismatched
brackets, unescaped newlines and control characters inside strings, JSON Lines documents,
invisible whitespace (NO-BREAK SPACE, BOM, U+2028) and invalid XML/HTML input.

On top of errors it also reports **warnings** for valid-but-risky documents: duplicate keys
(with the line of the value that gets overwritten), integers beyond `2^53 - 1`, numbers that
overflow to `Infinity`, lone surrogates and a leading BOM.

## Features

- **Beautify / Minify** with 2 spaces, 4 spaces or tabs; optional recursive key sorting.
- **Auto-fix** an invalid document and see the list of every change it made.
- **Editor-grade input**: line numbers, error line + column markers, `Tab` indent, smart `Enter`,
  drag & drop a `.json` file.
- **Tree view** of the parsed document with collapsible nodes, type colours and click-to-copy values.
- **Live stats**: lines, characters, bytes, value/key counts, max depth, minified size and the
  percentage of whitespace removed.
- **Clipboard copy, file download, file open, sample documents**, dark/light themes, keyboard
  shortcuts and session restore via `localStorage`.
- **Raw text preservation** — formatting never rewrites what you wrote: `1e3` stays `1e3`,
  `\u2764` stays `\u2764` (no accidental `1000` or rounded floats).

## Parquet & Avro readers

Drop a `.parquet` or `.avro` file anywhere (the **Open file** button and drag & drop both route
by magic bytes and extension) and the matching reader opens:

|                  | Parquet                                                                 | Avro                                                                 |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Engine           | `hyparquet` + `hyparquet-compressors` (all codecs incl. zstd & brotli)  | Hand-written OCF reader (zero runtime deps)                           |
| Codecs           | every codec `hyparquet-compressors` supports                            | `null` and `deflate` (via `DecompressionStream`)                      |
| Schema           | nested schema tree with logical types & repetition                      | nested tree: records, unions, enums, arrays, maps, fixed, logical types |
| Metadata         | row groups, sizes, codecs, created-by, key/value metadata               | header metadata, sync markers, per-block counts & sync verification   |
| Rows             | paged preview (`parquetReadObjects` with row ranges)                     | streamed decode with a record cap                                    |
| Common features  | sortable / filterable / paginated records table, column type badges, export to JSON, null rendering, BigInt/bytes/decimal-safe cell display | idem |

Both engines are code-split: the initial JSON bundle only loads Parquet/Avro code when such a
file is actually opened.


### Keyboard shortcuts

| Shortcut                 | Action            |
| ------------------------ | ----------------- |
| `⌘/Ctrl` + `Enter`       | Format (beautify) |
| `⌘/Ctrl` + `Shift` + `M` | Minify            |
| `⌘/Ctrl` + `Shift` + `F` | Auto-fix          |
| `Tab` / `Shift` + `Tab`  | Indent / outdent  |

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production build
npm test           # parser, formatter, repair and UI tests
```

## Command line (same engine)

```bash
node scripts/format-json.mjs data.json                    # beautify to stdout
node scripts/format-json.mjs data.json --indent tab -m     # minify with tabs
node scripts/format-json.mjs broken.json --fix --write     # repair in place
cat data.json | node scripts/format-json.mjs               # read from stdin
```

Exit code `1` means the document is invalid; the problem, hint and code frame go to stderr.

## Project layout

Each format is a self-contained module under `src/formats/<id>/` — engine, UI panel, samples and
tests live together. Shared binary-reader building blocks sit in `src/formats/shared/`, and
`src/formats/index.js` is the registry that powers the format switcher and file routing.

```
src/
  App.jsx                      shell: brand, format switcher, global file routing, theme
  main.jsx                     React entry point
  styles.css                   design tokens, layout, light/dark themes
  components/                  cross-format chrome (Icon, Toast) + jsdom app tests
  formats/
    index.js                   format registry + magic-byte detection
    json/                      JSON format module
      index.js                 descriptor (id, label, accept, lazy panel)
      jsonParser.js            strict parser with located errors + warnings
      jsonFormatter.js         raw-preserving beautify/minify + byte helpers
      jsonRepair.js            auto-fix engine
      samples.js               sample documents
      JsonPanel.jsx            editor + output workspace (lazy-loaded)
      JsonEditor.jsx           textarea + line numbers + error markers + shortcuts
      ErrorPanel.jsx           error card, code frame, warnings list
      JsonTree.jsx             collapsible document explorer
      StatsBar.jsx / Toolbar.jsx
      __tests__/               parser + formatter suites
    parquet/                   Parquet format module
      index.js                 descriptor
      parquetReader.js         hyparquet wrapper: metadata, schema tree, paged rows
      ParquetPanel.jsx         schema tree, row-group metadata, records table, export
      __tests__/               reader suite (real files written by hyparquet-writer)
    avro/                      Avro format module
      index.js                 descriptor
      avroReader.js            dependency-free OCF reader (header, blocks, datums)
      AvroPanel.jsx            schema tree, block metadata, records table, export
      __tests__/               reader suite (cross-checked against `avsc`)
    shared/                    building blocks reused by both binary readers
      binaryUtils.js           cell formatting, sorting, JSON-safe conversion, download
      RecordsTable.jsx         sortable / filterable / paginated records table
      SchemaView.jsx           collapsible nested schema tree
      DropZone.jsx             drag & drop + browse input
      RecordsMeta.jsx          file chips + row-count labels
      __tests__/               binaryUtils suite
scripts/format-json.mjs        CLI (JSON engine)
tools/                         tiny esbuild JSX loader + jsdom environment for node:test
```


## Testing

`npm test` runs the built-in Node test runner and needs no test framework:

- every parser diagnostic is asserted for `code`, `line`, `column`, message and hint, and the
  verdict is compared against `JSON.parse` for ~70 documents **plus 200 randomly generated ones**
- the formatter is checked for indentation, key sorting, CRLF, minifying and raw-literal
  preservation
- the auto-fixer is checked on trailing commas, comments, quotes, bare keys, missing commas,
  unterminated containers and a fully hand-written pseudo-JSON document
- the React UI is rendered in jsdom and driven like a user would (typing, clicking Format,
  Minify, Auto-fix, Copy, opening the tree, switching formats) to assert the *visible* error
  text, e.g. `Line 3, column 1 · Trailing comma before "}" is not allowed`
- the Parquet reader is tested against real files written by `hyparquet-writer` (both dev-only);
  the Avro reader is cross-validated against `avsc`-encoded container files, including the
  `deflate` codec, block sync markers, truncation and bad-magic handling

## Notes & limitations

- The parser is strict by design: comments, unquoted keys, single quotes and raw control
  characters inside strings are errors rather than silently accepted (use **Auto-fix** for those).
- Numbers are read as IEEE-754 doubles, so the tree and the stats reflect that; the formatter
  still prints the original literal, and anything unsafe is reported as a warning.
- The editor keeps text in a `<textarea>`, which keeps the app dependency-free and accessible.
  Validation is deferred (`useDeferredValue`) so typing stays responsive on big documents.
- Only one error is reported at a time: the parser stops at the first problem. Fix it (or press
  **Fix this for me**) to reveal the next one.
- The Avro reader supports the `null` and `deflate` codecs; `snappy`, `bzip2` and `zstandard`
  containers are rejected with a clear message naming the codec. It decodes the writer schema
  as-is (no reader-schema resolution/defaults).
- Binary readers decode rows in pages, so huge files stay responsive; the records table paginates
  and only renders the current page.
