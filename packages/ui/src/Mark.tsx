import type { CSSProperties } from 'react';

/**
 * The Huddle mark: the box's LED ring seen from above, twelve pixels with one lit. `lit` lights
 * more pixels (the lobby fills it as people join); `spin` walks the lit pixel round (connecting).
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
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g className={spin ? 'hd-spin' : undefined}>
        {Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const on = i < Math.max(0, Math.min(n, lit));
          return (
            <circle
              key={i}
              cx={20 + 15 * Math.cos(a)}
              cy={20 + 15 * Math.sin(a)}
              r={on ? 3.6 : 2.6}
              fill={on ? 'var(--c-flood)' : 'currentColor'}
              opacity={on ? 1 : 0.42}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Mark + lowercase wide "huddle". Size it with font-size. */
export function Wordmark({ className = '', lit = 1, spin = false }: { className?: string; lit?: number; spin?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.28em] font-display font-extrabold leading-none tracking-[-0.03em] ${className}`}
      style={{ fontStretch: '112.5%' }}
      translate="no"
    >
      <Mark size="1.05em" lit={lit} spin={spin} />
      <span>huddle</span>
    </span>
  );
}
