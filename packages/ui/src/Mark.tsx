import type { CSSProperties } from 'react';

/** Lit pixels walk the brand gradient: violet, magenta, pink, then gold. */
const LIT = ['#6C2BFF', '#8A2BFF', '#A62BFF', '#C42BF0', '#E02BC2', '#FF2E93', '#FF4B78', '#FF6B5A', '#FF8A3D', '#FFA028', '#FFB020', '#FFC83D'];

/**
 * The Huddle mark: the box's LED ring seen from above, twelve pixels with one lit. `lit` lights
 * more pixels (the lobby fills it as people join); `spin` walks the lit pixels round (connecting).
 */
export function Mark({
  size = '1em',
  lit = 1,
  spin = false,
  className = '',
  style,
}: {
  size?: string | number;
  lit?: number;
  spin?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const n = 12;
  const count = Math.max(0, Math.min(n, lit));
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} style={style} aria-hidden="true" focusable="false">
      <g className={spin ? 'hd-spin' : undefined}>
        {Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const on = i < count;
          return (
            <circle
              key={i}
              cx={20 + 15 * Math.cos(a)}
              cy={20 + 15 * Math.sin(a)}
              r={on ? 3.7 : 2.6}
              fill={on ? LIT[count === 1 ? 0 : i]! : 'currentColor'}
              opacity={on ? 1 : 0.32}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Mark + lowercase "huddle" in the display face. Size it with font-size. */
export function Wordmark({ className = '', lit = 1, spin = false }: { className?: string; lit?: number; spin?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.26em] font-extrabold leading-none tracking-[-0.04em] ${className}`}
      style={{ fontFamily: "'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif" }}
      translate="no"
    >
      <Mark size="1.05em" lit={lit} spin={spin} />
      <span>huddle</span>
    </span>
  );
}
