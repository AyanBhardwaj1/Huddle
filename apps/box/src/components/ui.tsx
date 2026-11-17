import type { LedPattern } from '@huddle/shared';
import { Icon } from '@huddle/ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { StatusChip } from '../lib/health';
import { useBox } from '../store';

export { Icon, Wordmark, Mark } from '@huddle/ui';

/* ---------------- Engine status line (home) ---------------- */

const DOT: Record<StatusChip['tone'], string> = { ok: 'bg-yes', info: 'bg-ink-muted', warn: 'bg-no', off: 'bg-rule-strong' };

/** A line of facts, each a small white chip; warnings carry an icon and their own colour. */
export function StatusLine({ chips }: { chips: StatusChip[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-2 text-body text-ink-2">
      {chips.map((c, i) => (
        <li
          key={c.id}
          className={`hd-rise flex items-center gap-2 rounded-full bg-card px-3 py-1.5 shadow-lift ${
            c.tone === 'warn' ? 'font-semibold text-no-600 ring-1 ring-inset ring-no-200' : c.tone === 'off' ? 'text-ink-muted' : ''
          }`}
          style={{ ['--d' as string]: `${i * 60}ms` }}
        >
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
  const current = useBox((s) => s.toast);
  // Keep the last toast for its exit (decorative only: nothing waits on it).
  const [shown, setShown] = useState<{ toast: NonNullable<typeof current>; leaving: boolean } | null>(null);
  useEffect(() => {
    if (current) {
      setShown({ toast: current, leaving: false });
      return;
    }
    setShown((s) => (s ? { ...s, leaving: true } : s));
    const t = setTimeout(() => setShown(null), 260);
    return () => clearTimeout(t);
  }, [current]);
  const toast = shown?.toast ?? null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-toast flex justify-center" aria-live="polite" role="status">
      {toast && (
        <div
          key={toast.id}
          className={`${shown?.leaving ? 'toast-out' : 'hd-drop'} flex max-w-[40rem] items-center gap-3 rounded-full py-2.5 pl-2.5 pr-5 text-lead font-semibold shadow-pop ${
            toast.tone === 'error' ? 'bg-card text-ink ring-2 ring-inset ring-hot' : 'bg-ink text-white'
          }`}
        >
          <span
            className={`hd-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              toast.tone === 'error' ? 'bg-hot text-hot-on' : toast.tone === 'ok' ? 'bg-zap text-white' : 'bg-white/15 text-white'
            }`}
            style={{ ['--d' as string]: '120ms' }}
          >
            <Icon name={toast.tone === 'error' ? 'warn' : toast.tone === 'ok' ? 'check' : 'bolt'} className="h-5 w-5" strokeWidth={2.6} />
          </span>
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
      className={`grid gap-2 ${className}`}
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
            className={`hd-press relative flex min-w-0 flex-col justify-center rounded-tile ${
              size === 'lg' ? 'min-h-[4.25rem] items-start px-3 py-2 text-left' : 'min-h-[3rem] items-center px-2 py-1.5 text-center'
            } ${on ? 'bg-zap text-white shadow-zap' : 'bg-card text-ink shadow-lift ring-1 ring-inset ring-rule hover:ring-zap-200'}`}
          >
            {size === 'lg' ? (
              <span className="flex items-center gap-1.5 font-head text-lead font-extrabold leading-tight">
                {on && <Icon name="check" className="hd-pop h-[0.9em] w-[0.9em] shrink-0" strokeWidth={3} />}
                {o.label}
              </span>
            ) : (
              <>
                {/* Compact options: the check sits in the corner so it never squeezes a short label. */}
                {on && <Icon name="check" className="hd-pop absolute right-1.5 top-1.5 h-[0.7rem] w-[0.7rem]" strokeWidth={3.5} />}
                <span className="whitespace-nowrap text-body font-bold leading-tight">{o.label}</span>
              </>
            )}
            {o.sub && <span className={`mt-0.5 text-small leading-snug ${on ? 'text-white/90' : 'text-ink-muted'}`}>{o.sub}</span>}
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
      className="hd-press flex min-h-[3rem] w-full items-center justify-between gap-4 rounded-tile bg-card px-4 text-left shadow-lift ring-1 ring-inset ring-rule hover:ring-zap-200"
    >
      <span className="text-body font-semibold">{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-base ${on ? 'bg-zap' : 'bg-rule-strong'}`}>
        <span
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-lift transition-transform duration-slow ease-spring ${on ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}
