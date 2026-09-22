import Icon from './Icon.jsx';

/**
 * Keyboard-shortcut cheat sheet, opened from the header (`?` button or the
 * `?` / `⌘/Ctrl + /` keys) and closed with `Esc`. Documents the global
 * shortcuts wired in App.jsx plus the JSON editor's built-in key bindings.
 */
const GROUPS = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['⌘/Ctrl', '1'], desc: 'Switch to the JSON workspace' },
      { keys: ['⌘/Ctrl', '2'], desc: 'Switch to the Parquet workspace' },
      { keys: ['⌘/Ctrl', '3'], desc: 'Switch to the Avro workspace' },
      { keys: ['⌘/Ctrl', 'O'], desc: 'Open a file — the format is auto-detected' },
      { keys: ['⌘/Ctrl', '⇧', 'L'], desc: 'Toggle the dark / light theme' },
      { keys: ['?'], desc: 'Show or hide this shortcut guide' },
      { keys: ['Esc'], desc: 'Close this guide' },
    ],
  },
  {
    title: 'JSON editor',
    rows: [
      { keys: ['⌘/Ctrl', '⏎'], desc: 'Format / beautify the document' },
      { keys: ['⌘/Ctrl', '⇧', 'M'], desc: 'Minify the document' },
      { keys: ['⌘/Ctrl', '⇧', 'F'], desc: 'Auto-fix reported problems' },
      { keys: ['Tab', '⇧ Tab'], desc: 'Indent / outdent the current line' },
    ],
  },
  {
    title: 'Mouse',
    rows: [
      { keys: ['Drop'], desc: 'Drop a file anywhere on the page — it routes to the right reader' },
      { keys: ['Browse'], desc: 'Every reader also offers a drop zone with a browse link' },
    ],
  },
];

export default function ShortcutsHelp({ onClose }) {
  return (
    <div
      className="shortcuts-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="shortcuts-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="shortcuts-head">
          <h2>
            <Icon name="help" size={16} /> Keyboard shortcuts
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="shortcuts-body">
          {GROUPS.map((group) => (
            <section className="shortcuts-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.rows.map((row) => (
                <div className="shortcut-row" key={row.desc}>
                  <span>{row.desc}</span>
                  <span className="keys">
                    {row.keys.map((key, index) => (
                      <kbd key={`${key}-${index}`}>{key}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <footer className="shortcuts-foot">⌘ on macOS · Ctrl on Windows and Linux</footer>
      </div>
    </div>
  );
}