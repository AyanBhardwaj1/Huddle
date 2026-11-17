import type { CSSProperties, ReactNode } from 'react';
import { useReplayClass } from './motion';
import { Icon } from './Icon';
import { Roll } from './Roll';

export type LockState = 'open' | 'urgent' | 'locked' | 'manual';

/**
 * The lock countdown, drawn as the box's LED ring: a circle of pixels that go dark one by one.
 * The seconds roll down and condense (variable-font width) as time runs out; in the last 5 s the
 * ring turns hot, throbs once a second, glows, and every tick stamps. Locked: the padlock snaps in.
 *
 * `compact` drops the caption and thickens the pixels for small sizes (phone cards, rails).
 */
export function LockRing({
  fraction,
  label,
  state,
  size = '10rem',
  dots = 24,
  caption,
  compact = false,
  className = '',
}: {
  /** 1 at open, 0 at lock; null when the market locks on a play rather than a clock. */
  fraction: number | null;
  /** Seconds text ("14", "1:20"). */
  label: string | null;
  state: LockState;
  size?: string;
  dots?: number;
  caption?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const f = fraction === null ? 1 : Math.min(1, Math.max(0, fraction));
  const n = compact ? Math.min(dots, 16) : dots;
  const lit = state === 'locked' ? 0 : state === 'manual' ? n : Math.ceil(f * n);
  const beat = useReplayClass(state === 'urgent' ? label : null, 'hd-beat');
  const snap = useReplayClass(state === 'locked', 'hd-snap-x');
  const urgent = state === 'urgent';
  // 62% wide at the lock, 100% at the open: the number literally tightens.
  const stretch = 62 + Math.round(38 * f);
  const r = 44;
  const on = urgent ? 'var(--hd-ring-urgent)' : 'var(--hd-ring-on)';
  return (
    <div
      className={`hd-ring relative shrink-0 ${className}`}
      data-state={state}
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
      aria-label={state === 'locked' ? 'Locked' : label ? `${label} seconds to lock` : 'Open until the play'}
    >
      <span className="hd-ring-glow" aria-hidden="true" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g className="hd-ring-dots">
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const isOn = i < lit;
            return (
              <circle
                key={i}
                className="hd-ring-dot"
                data-on={isOn}
                cx={50 + r * Math.cos(a)}
                cy={50 + r * Math.sin(a)}
                r={compact ? 4.6 : urgent ? 3.7 : 3.3}
                fill={isOn ? on : 'var(--hd-ring-off)'}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {state === 'locked' ? (
          <span key="locked" className={`flex flex-col items-center ${snap ? 'hd-snap' : ''}`}>
            <Icon name="lock" style={{ width: `calc(${size} * 0.26)`, height: `calc(${size} * 0.26)` }} strokeWidth={2.4} />
            {!compact && (
              <span className="mt-[0.15em] font-extrabold" style={{ fontSize: `calc(${size} * 0.13)`, fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif" }}>
                Locked
              </span>
            )}
          </span>
        ) : label ? (
          <>
            <span
              className={`hd-num block leading-none ${beat}`}
              style={
                {
                  fontSize: `calc(${size} * ${label.length > 2 ? 0.3 : compact ? 0.4 : 0.44})`,
                  fontStretch: `${stretch}%`,
                  fontWeight: urgent ? 900 : 800,
                  color: urgent ? 'var(--hd-ring-urgent)' : undefined,
                  transition: 'font-stretch 240ms linear',
                } as CSSProperties
              }
            >
              <Roll text={label} flash={false} duration={320} />
            </span>
            {caption && !compact && <span style={{ fontSize: `calc(${size} * 0.1)` }}>{caption}</span>}
          </>
        ) : (
          <span className="max-w-[62%] text-center font-extrabold leading-tight" style={{ fontSize: `calc(${size} * ${compact ? 0.16 : 0.1})` }}>
            {compact ? <Icon name="hourglass" style={{ width: `calc(${size} * 0.32)`, height: `calc(${size} * 0.32)` }} /> : (caption ?? 'Open')}
          </span>
        )}
      </div>
    </div>
  );
}
