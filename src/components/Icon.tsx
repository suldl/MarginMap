import type { ReactNode, SVGProps } from 'react';

const paths = {
  back: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  check: <path d="M20 6L9 17l-5-5" />,
  import: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5V5a2 2 0 012-2h13v16H6.5A2.5 2.5 0 004 21.5" />
      <path d="M4 19.5A2.5 2.5 0 016.5 17H19" />
    </>
  ),
  notebook: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 3v18M3 8h4M3 12h4M3 16h4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  toc: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  mindmap: (
    <>
      <rect x="2" y="9" width="6" height="6" rx="1.5" />
      <rect x="16" y="3" width="6" height="5" rx="1.5" />
      <rect x="16" y="16" width="6" height="5" rx="1.5" />
      <path d="M8 12h4m0 0V5.5h4M12 12v6.5h4" />
    </>
  ),
  outline: <path d="M3 5h12M7 10h14M7 15h14M3 20h12M3 5v0" />,
  docOnly: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M8 11h6" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  fitWidth: <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  area: (
    <>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" strokeDasharray="2 2" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  swap: <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  cards: (
    <>
      <rect x="3" y="7" width="14" height="13" rx="2" />
      <path d="M7 4h12a2 2 0 012 2v11" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  comment: <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" />,
  tag: (
    <>
      <path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  collapse: <path d="M7 15l5-5 5 5M7 20l5-5 5 5" />,
  expand: <path d="M7 4l5 5 5-5M7 9l5 5 5-5" />,
  brain: (
    <>
      <path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V7a3 3 0 00-3-3z" />
      <path d="M15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0" />
    </>
  ),
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
    </>
  ),
  child: <path d="M5 4v8a3 3 0 003 3h11M15 11l4 4-4 4" />,
  sibling: <path d="M5 4v14M5 11h8M5 18h8M17 11h.01M17 18h.01" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  enlarge: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  whiteboard: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M12 16v5M8 21h8M7 12l3-4 2 2 3-3 2 2" />
    </>
  ),
  cursor: <path d="M5 3l14 7-6 2-2 6z" />,
  hand: (
    <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V12m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.5a6 6 0 01-4.9-2.6L5.2 15a1.6 1.6 0 012.6-1.9L8 13.4" />
  ),
  pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />,
  marker: (
    <>
      <path d="M9 11l-6 6v3h9l3-3" />
      <path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4" />
    </>
  ),
  eraser: (
    <>
      <path d="M20 20H9L4.6 15.6a2 2 0 010-2.8L14.2 3.2a2 2 0 012.8 0l4 4a2 2 0 010 2.8L11 20" />
      <path d="M9.5 8.5l6 6" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="2" />,
  circle: <circle cx="12" cy="12" r="8.5" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
  front: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.25" />
      <path d="M4 16V5a1 1 0 011-1h11" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 100 18c1.1 0 1.7-.9 1.4-1.9-.4-1.2.4-2.1 1.6-2.1H17a4 4 0 004-4c0-5.5-4-10-9-10z" />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="8" r="1.2" fill="currentColor" />
    </>
  ),
  sigma: <path d="M18 7V4H6l6 8-6 8h12v-3" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 01-15.5 6.2M3 12A9 9 0 0118.5 5.8" />
      <path d="M18.5 2v3.8h-3.8M5.5 22v-3.8h3.8" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  group: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 2.5" />
      <rect x="7" y="7" width="5" height="4" rx="1" />
      <rect x="12" y="13" width="5" height="4" rx="1" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />,
  tidy: (
    <>
      <rect x="3" y="10" width="6" height="4" rx="1" />
      <rect x="15" y="4" width="6" height="4" rx="1" />
      <rect x="15" y="16" width="6" height="4" rx="1" />
      <path d="M9 12h3m0 0V6h3m-3 6v6h3" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
