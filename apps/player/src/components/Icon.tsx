import type { SVGProps } from 'react';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5.5 11.5L12 5l6.5 6.5',
  down: 'M12 5v14M5.5 12.5L12 19l6.5-6.5',
  lock: 'M7 11V8a5 5 0 0110 0v3M5.5 11h13v9h-13z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  trophy: 'M8 4h8v5a4 4 0 01-8 0V4zM8 6H4.5a3 3 0 003.5 4M16 6h3.5A3 3 0 0116 10M12 13v4M8.5 20h7M10 17h4v3h-4z',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21',
  speaker: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4',
  list: 'M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  ticket: 'M4 7.5V5h16v2.5a2.5 2.5 0 000 5V15H4v-2.5a2.5 2.5 0 000-5zM4 15v4h16v-4',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  hourglass: 'M7 3h10M7 21h10M8 3v3.5a4 4 0 002 3.4L12 12l2-1.1a4 4 0 002-3.4V3M8 21v-3.5a4 4 0 012-3.4L12 12l2 2.1a4 4 0 012 3.4V21',
  wifi: 'M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.5 16a5 5 0 017 0M12 19.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
