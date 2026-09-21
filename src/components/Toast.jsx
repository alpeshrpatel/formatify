import Icon from './Icon.jsx';

const TONE_ICON = { success: 'check', error: 'alert', info: 'info' };

/** Small transient message in the corner of the screen. */
export default function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  const tone = toast.tone ?? 'info';
  return (
    <div className={`toast is-${tone}`} role="status" aria-live="polite">
      <Icon name={TONE_ICON[tone] ?? 'info'} />
      <span>{toast.message}</span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
