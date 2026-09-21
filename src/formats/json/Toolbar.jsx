import Icon from '../../components/Icon.jsx';

function ToolButton({ icon, label, onClick, title, variant = '', disabled, showLabel = true }) {
  return (
    <button
      type="button"
      className={`btn ${variant}`.trim()}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      <Icon name={icon} />
      {showLabel && <span>{label}</span>}
    </button>
  );
}

/** Every action the app offers, grouped by what it does. */
export default function Toolbar({
  onFormat,
  onMinify,
  onAutoFix,
  onCopy,
  onDownload,
  onPickFile,
  onSample,
  onClear,
  indent,
  onIndentChange,
  sortKeys,
  onSortKeysChange,
  hasError,
  isEmpty,
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="JSON actions">
      <div className="toolbar-group">
        <ToolButton
          icon="format"
          label="Format"
          variant="btn-primary"
          onClick={onFormat}
          disabled={isEmpty}
          title="Beautify the document (⌘/Ctrl + Enter)"
        />
        <ToolButton
          icon="minify"
          label="Minify"
          onClick={onMinify}
          disabled={isEmpty}
          title="Remove all whitespace (⌘/Ctrl + Shift + M)"
        />
        <ToolButton
          icon="wand"
          label="Auto-fix"
          variant="btn-accent"
          onClick={onAutoFix}
          disabled={!hasError}
          title={
            hasError
              ? 'Repair the reported problem and try again (⌘/Ctrl + Shift + F)'
              : 'Nothing to fix — the document is already valid'
          }
        />
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className={sortKeys ? 'chip is-on' : 'chip'}
          aria-pressed={sortKeys}
          onClick={() => onSortKeysChange(!sortKeys)}
          title="Sort object keys alphabetically when formatting"
        >
          <Icon name="sort" />
          <span>Sort keys</span>
        </button>

        <label className="select-wrap" title="Indentation used when formatting">
          <span className="select-label">Indent</span>
          <select value={indent} onChange={(event) => onIndentChange(event.target.value)}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
          </select>
        </label>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <ToolButton
          icon="copy"
          label="Copy"
          onClick={onCopy}
          disabled={isEmpty}
          title="Copy the editor contents to the clipboard"
        />
        <ToolButton
          icon="download"
          label="Download"
          onClick={onDownload}
          disabled={isEmpty}
          title="Download the editor contents as a .json file"
        />
        <ToolButton
          icon="upload"
          label="Open"
          onClick={onPickFile}
          title="Open a .json file from disk (or drop a file on the editor)"
        />
        <ToolButton icon="plus" label="Sample" onClick={onSample} title="Load the next sample document" />
        <ToolButton
          icon="trash"
          label="Clear"
          variant="btn-ghost"
          onClick={onClear}
          disabled={isEmpty}
          title="Empty the editor"
        />
      </div>
    </div>
  );
}
