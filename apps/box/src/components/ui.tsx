import type { LedPattern } from '@huddle/shared';
import { Icon } from '@huddle/ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { StatusChip } from '../lib/health';
import { useBox } from '../store';

export { Icon, Wordmark, Mark } from '@huddle/ui';

/* ---------------- Engine status line (home) ---------------- */

const DOT: Record<StatusChip['tone'], string> = { ok: 'bg-yes', info: 'bg-night-400', warn: 'bg-no', off: 'bg-night-600' };

/** A quiet line of facts, not a row of pills. Warnings carry an icon and their own colour. */
export function StatusLine({ chips }: { chips: StatusChip[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body text-night-200">
      {chips.map((c) => (
        <li key={c.id} className={`flex items-center gap-2 ${c.tone === 'warn' ? 'text-no-bright' : c.tone === 'off' ? 'text-night-400' : ''}`}>
          {c.tone === 'warn' ? (
            <Icon name="warn" className="h-[1.1em] w-[1.1em]" />
          ) : (
            <span className={`h-2 w-2 rounded-full ${DOT[c.tone]}`} aria-hidden="true" />
          )}
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- LED ring mirror ---------------- */

export function LedRing({ led }: { led: { pattern: LedPattern; color: string } | null }) {
  // Re-trigger one-shot animations on every message, even with the same pattern.
  const [n, setN] = useState(0);
  useEffect(() => {
    if (led) setN((x) => x + 1);
  }, [led]);
  if (!led) return null;
  return <div key={n} className={`led-ring led-${led.pattern}`} style={{ ['--led' as string]: led.color }} aria-hidden="true" />;
}

/* ---------------- Toast ---------------- */

export function ToastHost() {
  const toast = useBox((s) => s.toast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-toast flex justify-center" aria-live="polite" role="status">
      {toast && (
        <div
          key={toast.id}
          className={`hd-drop flex max-w-[40rem] items-center gap-3 rounded-tile px-5 py-3 text-lead font-semibold shadow-float ${
            toast.tone === 'error' ? 'bg-no-deep text-chalk ring-1 ring-inset ring-no-dim' : 'bg-night-800 text-chalk ring-1 ring-inset ring-night-600'
          }`}
        >
          <Icon
            name={toast.tone === 'error' ? 'warn' : 'check'}
            className={`h-[1.2em] w-[1.2em] shrink-0 ${toast.tone === 'error' ? 'text-no' : toast.tone === 'ok' ? 'text-flood' : 'text-night-200'}`}
          />
          <span className="min-w-0">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Segmented control ---------------- */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
  testIdPrefix,
  label,
}: {
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'md' | 'lg';
  /** Adds data-testid="<prefix>-<value>" to each option (e2e hooks, see e2e/README.md). */
  testIdPrefix?: string;
  /** Accessible name for the group. */
  label?: string;
}) {
  return (
    <div
      className={`grid gap-1.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={testIdPrefix ? `${testIdPrefix}-${String(o.value)}` : undefined}
            onClick={() => onChange(o.value)}
            className={`flex min-w-0 flex-col items-start justify-center rounded-tile px-3 text-left transition-[background-color,color,box-shadow] duration-quick ease-out active:scale-[0.98] ${
              size === 'lg' ? 'min-h-[4.25rem] py-2' : 'min-h-[3rem] py-1.5'
            } ${on ? 'bg-chalk text-night-950' : 'bg-night-800 text-chalk hover:bg-night-700'}`}
          >
            <span className="flex items-center gap-1.5 text-lead font-bold leading-tight">
              {on && <Icon name="check" className="h-[0.9em] w-[0.9em] shrink-0" strokeWidth={3} />}
              {o.label}
            </span>
            {o.sub && <span className={`mt-0.5 text-small leading-snug ${on ? 'text-night-700' : 'text-night-400'}`}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[3rem] w-full items-center justify-between gap-4 rounded-tile bg-night-800 px-4 text-left transition-colors duration-quick hover:bg-night-700"
    >
      <span className="text-body font-semibold">{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-base ${on ? 'bg-flood' : 'bg-night-600'}`}>
        <span
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-night-950 transition-transform duration-base ease-out ${on ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}
