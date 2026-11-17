import type { CSSProperties, ReactNode } from 'react';
import { useReplayClass } from './motion';
import { Icon } from './Icon';

export type LockState = 'open' | 'urgent' | 'locked' | 'manual';

/**
 * The lock countdown, drawn as the box's LED ring: a circle of pixels that go dark one by one.
 * The seconds condense (variable-font width) as time runs out; in the last 5 s the ring throbs
 * once a second and the number turns chalk-white and heavy. Locked: the padlock stamps in.
 */
export function LockRing({
  fraction,
  label,
  state,
  size = '10rem',
  dots = 24,
  caption,
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
  className?: string;
}) {
  const f = fraction === null ? 1 : Math.min(1, Math.max(0, fraction));
  const lit = state === 'locked' ? 0 : state === 'manual' ? dots : Math.ceil(f * dots);
  const beat = useReplayClass(state === 'urgent' ? label : null, 'hd-beat');
  const snap = useReplayClass(state === 'locked', 'hd-snap-x');
  const urgent = state === 'urgent';
  // 62% wide at the lock, 100% at the open: the number literally tightens.
  const stretch = 62 + Math.round(38 * f);
  const r = 44;
  return (
    <div
      className={`hd-ring relative shrink-0 ${className}`}
      data-state={state}
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
      aria-label={state === 'locked' ? 'Locked' : label ? `${label} seconds to lock` : 'Open until the play'}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g className="hd-ring-dots">
          {Array.from({ length: dots }, (_, i) => {
            const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
            const on = i < lit;
            return (
              <circle
                key={i}
                className="hd-ring-dot"
                cx={50 + r * Math.cos(a)}
                cy={50 + r * Math.sin(a)}
                r={urgent ? 3.6 : 3.1}
                fill={on ? (urgent ? 'var(--c-chalk)' : 'var(--c-flood)') : 'var(--c-night-700)'}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {state === 'locked' ? (
          <span key="locked" className={`flex flex-col items-center ${snap ? 'hd-snap' : ''}`}>
            <Icon name="lock" style={{ width: `calc(${size} * 0.26)`, height: `calc(${size} * 0.26)` }} strokeWidth={2.2} />
            <span className="mt-[0.15em] font-display font-extrabold" style={{ fontSize: `calc(${size} * 0.13)`, fontStretch: '87.5%' }}>
              Locked
            </span>
          </span>
        ) : label ? (
          <>
            <span
              className={`hd-num block font-black leading-none ${beat}`}
              style={
                {
                  fontSize: `calc(${size} * ${label.length > 2 ? 0.3 : 0.44})`,
                  fontStretch: `${stretch}%`,
                  fontWeight: urgent ? 900 : 800,
                  color: urgent ? 'var(--c-chalk)' : undefined,
                  transition: 'font-stretch 240ms linear',
                } as CSSProperties
              }
            >
              {label}
            </span>
            {caption && <span style={{ fontSize: `calc(${size} * 0.1)` }}>{caption}</span>}
          </>
        ) : (
          <span className="max-w-[62%] text-center font-display font-extrabold leading-tight" style={{ fontSize: `calc(${size} * 0.1)` }}>
            {caption ?? 'Open'}
          </span>
        )}
      </div>
    </div>
  );
}
