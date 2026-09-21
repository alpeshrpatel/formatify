import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { countLines } from './jsonFormatter.js';

const LINE_HEIGHT = 22;
const PAD_TOP = 14;
/** Left padding of the textarea — must match `.editor-input` padding-left. */
const TEXT_OFFSET = 74;

const INDENT_UNITS = { 2: '  ', 4: '    ', tab: '\t' };

/**
 * The code editor.
 *
 * A `<textarea>` is used on purpose: it gives us native caret handling,
 * accessibility, undo/redo and IME support for free. The line numbers, the
 * error banner and the error column marker are DOM overlays that follow the
 * textarea's scroll offset.
 */
export default function JsonEditor({
  value,
  onChange,
  error,
  indent = 2,
  onFormat,
  onMinify,
  onAutoFix,
  onLoadFile,
  ref,
}) {
  const textareaRef = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const pendingSelection = useRef(null);

  const unit = INDENT_UNITS[indent] ?? '  ';
  const lineCount = useMemo(() => countLines(value), [value]);

  // A controlled textarea loses its caret when React re-renders: restore it.
  useEffect(() => {
    const caret = pendingSelection.current;
    if (caret && textareaRef.current) {
      textareaRef.current.setSelectionRange(caret[0], caret[1]);
      pendingSelection.current = null;
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    /** Focus the editor and select the character at `index`. */
    selectIndex(index) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const safe = Math.max(0, Math.min(index, value.length));
      const line = (value.slice(0, safe).match(/\n/g) ?? []).length;
      textarea.setSelectionRange(safe, Math.min(safe + 1, value.length));
      textarea.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
    },
  }));

  /** Replaces `value[start..end]` and puts the caret after the replacement. */
  const replaceRange = (start, end, replacement) => {
    pendingSelection.current = [start + replacement.length, start + replacement.length];
    onChange(value.slice(0, start) + replacement + value.slice(end));
  };

  const handleKeyDown = (event) => {
    const textarea = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key === 'Enter') {
      event.preventDefault();
      onFormat?.();
      return;
    }
    if (meta && event.shiftKey && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault();
      onMinify?.();
      return;
    }
    if (meta && event.shiftKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      onAutoFix?.();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const before = value.slice(lineStart, start);
        const trailingSpaces = / +$/.exec(before);
        const removable = before.endsWith('\t')
          ? 1
          : Math.min(unit.length, trailingSpaces ? trailingSpaces[0].length : 0);
        if (removable > 0) replaceRange(start - removable, start, '');
        return;
      }
      replaceRange(start, end, unit);
      return;
    }
    if (event.key !== 'Enter') return;

    // Enter keeps the indentation and opens/closes blocks the way an IDE does.
    event.preventDefault();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.slice(lineStart, start);
    const currentIndent = (/^[ \t]*/.exec(currentLine) ?? [''])[0];
    const opensBlock = /[{[]\s*$/.test(currentLine);
    const closesBlock = /^[\]}]/.test(value[end] ?? '');

    let inserted = `\n${currentIndent}${opensBlock ? unit : ''}`;
    let caret = start + inserted.length;
    if (opensBlock && closesBlock) {
      inserted = `\n${currentIndent}${unit}\n${currentIndent}`;
      caret = start + 1 + currentIndent.length + unit.length;
    }
    pendingSelection.current = [caret, caret];
    onChange(value.slice(0, start) + inserted + value.slice(end));
  };

  const handleDrop = async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    onLoadFile?.(await file.text(), file.name);
  };

  const errorTop = error ? PAD_TOP + (error.line - 1) * LINE_HEIGHT - scroll.top : 0;
  // `ch` is the advance width of "0" in a monospace font, so 1ch == one character.
  const errorLeft = error
    ? `calc(${TEXT_OFFSET}px + ${error.column - 1}ch - ${scroll.left}px)`
    : 0;

  return (
    <div className="editor">
      <div className="editor-gutter" aria-hidden="true">
        <div className="editor-gutter-inner" style={{ transform: `translateY(${-scroll.top}px)` }}>
          {Array.from({ length: lineCount }, (_, index) => {
            const line = index + 1;
            const isError = Boolean(error) && error.line === line;
            return (
              <div
                key={line}
                className={isError ? 'editor-line-number is-error' : 'editor-line-number'}
                style={{ height: LINE_HEIGHT }}
              >
                {line}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="editor-marks" aria-hidden="true">
          <div className="editor-error-line" style={{ top: errorTop, height: LINE_HEIGHT }} />
          <div
            className="editor-error-caret"
            style={{ top: errorTop, height: LINE_HEIGHT, left: errorLeft }}
          />
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="editor-input"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        wrap="off"
        aria-label="JSON editor"
        placeholder={'{\n  "paste": "your JSON here"\n}'}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) =>
          setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
        }
        onKeyDown={handleKeyDown}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      />
    </div>
  );
}

