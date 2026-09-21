import { useMemo } from 'react';

import { countLines, formatBytes, minifyJson, utf8Size } from './jsonFormatter.js';

/** Live measurements of the document currently in the editor. */
export default function StatsBar({ text, result, indent }) {
  const bytes = utf8Size(text);

  const minified = useMemo(() => {
    if (!result.ok || !text.trim()) return null;
    try {
      return utf8Size(minifyJson(text, { indent }));
    } catch {
      return null;
    }
  }, [result.ok, text, indent]);

  const saving = minified && bytes > 0 ? Math.round((1 - minified / bytes) * 100) : null;
  const stats = result.stats;

  const items = [
    { label: 'Lines', value: countLines(text).toLocaleString() },
    { label: 'Characters', value: text.length.toLocaleString() },
    { label: 'Size', value: formatBytes(bytes) },
    {
      label: 'Values',
      value: stats ? stats.total.toLocaleString() : '—',
      title: 'Every object, array, string, number, boolean and null',
    },
    { label: 'Keys', value: stats ? stats.keys.toLocaleString() : '—' },
    { label: 'Max depth', value: stats ? String(stats.maxDepth) : '—' },
    {
      label: 'Minified',
      value: minified ? formatBytes(minified) : '—',
      title: 'Size after minifying, without whitespace',
    },
    {
      label: 'Whitespace saved',
      value: saving === null ? '—' : `${saving}%`,
      tone: saving !== null && saving > 20 ? 'is-good' : '',
    },
  ];

  return (
    <div className="stats-bar">
      {items.map((item) => (
        <div key={item.label} className={`stat ${item.tone ?? ''}`.trim()} title={item.title}>
          <span className="stat-value">{item.value}</span>
          <span className="stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
