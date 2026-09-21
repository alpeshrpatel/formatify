import { useState } from 'react';

import Icon from '../../components/Icon.jsx';

/**
 * Drop zone used by the binary readers. Accepts click-to-browse and
 * drag & drop, and reports the chosen `File` via `onFile`.
 */
export default function DropZone({ accept, onFile, compact = false, hint }) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={dragging ? 'dropzone is-dragging' : 'dropzone'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) onFile(file);
      }}
    >
      <span className="dropzone-icon">
        <Icon name="upload" size={compact ? 18 : 22} />
      </span>
      <div>
        <p className="dropzone-title">
          Drop a file here, or{' '}
          <label className="dropzone-browse">
            browse
            <input
              type="file"
              accept={accept}
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </p>
        {hint ? <p className="dropzone-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
