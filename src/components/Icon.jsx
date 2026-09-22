/** Minimal inline icon set (24x24, stroke based) so the app stays dependency free. */

const ICONS = {
  format: <path d="M4 6h16M4 12h11M4 18h14" />,
  minify: <path d="M9 9H4V4M15 15h5v5M15 9h5V4M9 15H4v5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4V4h11v1" />
    </>
  ),
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />,
  upload: <path d="M12 17V5m0 0L8 9m4-4l4 4M4 21h16" />,
  wand: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  alert: <path d="M10.3 3.9L1.8 18A2 2 0 003.5 21h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4m0 4h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5m0-3h.01" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 22h4M12 2a6 6 0 00-3.5 10.9V15h7v-2.1A6 6 0 0012 2z" />
    </>
  ),
  sort: <path d="M4 6h9M4 12h6M4 18h3M17 5v14m0 0l-3.5-3.5M17 19l3.5-3.5" />,
  trash: <path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10M15 10v10" />
    </>
  ),
  boxes: (
    <>
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" />
      <path d="M12 11L4 6.5M12 11l8-4.5M12 11v9" />
    </>
  ),
  file: <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a3 3 0 115.5 1.7c-.9 1-2.6 1.3-2.6 3.3" />
      <path d="M12 17h.01" />
    </>
  ),
  braces: <path d="M9 3H7a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2h2M15 3h2a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-2" />,
};

export default function Icon({ name, size = 16, className }) {
  const art = ICONS[name];
  if (!art) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {art}
    </svg>
  );
}
