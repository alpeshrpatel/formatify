import Icon from '../../components/Icon.jsx';

function CodeFrame({ frame }) {
  return (
    <pre className="code-frame">
      {frame.split('\n').map((row, index) => (
        <div
          key={`${index}-${row}`}
          className={row.startsWith('>') ? 'frame-row is-error' : 'frame-row'}
        >
          {row}
        </div>
      ))}
    </pre>
  );
}

function WarningList({ warnings }) {
  if (!warnings.length) return null;
  return (
    <ul className="warning-list">
      {warnings.map((warning) => (
        <li key={`${warning.code}-${warning.index}`}>
          <Icon name="info" />
          <span>{warning.message}</span>
          <span className="line-tag">line {warning.line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shows either the exact syntax error (with line, column, code frame and a fix
 * hint) or, when the document is valid, its warnings.
 */
export default function ErrorPanel({ error, warnings, stats, onJump, onAutoFix }) {
  if (!error) {
    return (
      <div className="panel-body">
        <section className="status-card is-valid">
          <span className="status-icon">
            <Icon name="check" size={20} />
          </span>
          <div>
            <h2>Valid JSON</h2>
            <p>
              Parsed without errors — {stats.total.toLocaleString()} values,{' '}
              {stats.keys.toLocaleString()} keys, {stats.maxDepth} level
              {stats.maxDepth === 1 ? '' : 's'} deep.
            </p>
          </div>
        </section>
        {warnings.length > 0 ? (
          <>
            <h3 className="section-title">
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </h3>
            <WarningList warnings={warnings} />
          </>
        ) : (
          <p className="empty-hint">
            No warnings. Duplicate keys, unsafe integers and lone surrogates would show up here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel-body">
      <section className="status-card is-error">
        <span className="status-icon">
          <Icon name="alert" size={20} />
        </span>
        <div className="status-text">
          <h2>Invalid JSON</h2>
          <p>The document cannot be parsed. The first problem was found at:</p>
        </div>
        <span className="badge badge-danger">{error.code}</span>
      </section>

      <div className="location-row">
        <button type="button" className="loc-chip is-action" onClick={onJump} title="Select this character in the editor">
          <Icon name="file" />
          Line {error.line}, column {error.column}
        </button>
        <span className="loc-chip">character {error.index + 1}</span>
        {error.token ? <span className="loc-chip">near {JSON.stringify(error.token)}</span> : null}
      </div>

      <p className="error-message">{error.message}</p>

      {error.hint ? (
        <p className="error-hint">
          <Icon name="bulb" />
          <span>{error.hint}</span>
        </p>
      ) : null}

      <CodeFrame frame={error.codeFrame} />

      <div className="action-row">
        <button type="button" className="btn btn-primary" onClick={onJump}>
          <Icon name="file" />
          <span>Go to line {error.line}</span>
        </button>
        <button type="button" className="btn btn-accent" onClick={onAutoFix}>
          <Icon name="wand" />
          <span>Fix this for me</span>
        </button>
        <span className="action-note">
          Auto-fix repairs the reported problem, then re-parses the document.
        </span>
      </div>

      {warnings.length > 0 && (
        <>
          <h3 className="section-title">Also worth knowing</h3>
          <WarningList warnings={warnings} />
        </>
      )}
    </div>
  );
}

export { CodeFrame, WarningList };
