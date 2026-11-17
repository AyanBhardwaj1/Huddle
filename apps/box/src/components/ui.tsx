import type { LedPattern } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import type { StatusChip } from '../lib/health';
import { useBox } from '../store';

/* ---------------- Icons (inline, bundled, offline-safe) ---------------- */

type IconName =
  | 'lock'
  | 'mic'
  | 'check'
  | 'x'
  | 'nfc'
  | 'crown'
  | 'play'
  | 'pause'
  | 'cog'
  | 'up'
  | 'down'
  | 'flag'
  | 'warn'
  | 'next'
  | 'plus'
  | 'sound'
  | 'remote'
  | 'link';

const PATHS: Record<IconName, ReactNode> = {
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  nfc: (
    <>
      <path d="M8.5 8.5a5 5 0 0 1 0 7" />
      <path d="M12 5.5a9 9 0 0 1 0 13" />
      <path d="M15.5 2.5a13 13 0 0 1 0 19" />
      <circle cx="5" cy="12" r="1.5" />
    </>
  ),
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />,
  play: <path d="M7 4.5v15l12-7.5-12-7.5z" />,
  pause: <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" />,
  cog: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" />
    </>
  ),
  up: <path d="M12 5l7 9H5l7-9z" />,
  down: <path d="M12 19l-7-9h14l-7 9z" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  warn: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  next: <path d="M5 5l8 7-8 7M13 5l8 7-8 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sound: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  remote: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

const FILLED: IconName[] = ['play', 'pause', 'up', 'down', 'crown'];

export function Icon({ name, className = 'h-[1em] w-[1em]', ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const filled = FILLED.includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/* ---------------- Wordmark ---------------- */

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.18em] font-display font-bold uppercase italic leading-none tracking-tight ${className}`}
    >
      <span className="relative inline-block h-[0.78em] w-[0.78em] rounded-full border-[0.14em] border-volt">
        <span className="absolute inset-[22%] rounded-full bg-volt" />
      </span>
      Huddle
    </span>
  );
}

/* ---------------- Status chips ---------------- */

const CHIP_TONE: Record<StatusChip['tone'], string> = {
  ok: 'bg-pitch-800 text-pitch-50 ring-pitch-600',
  info: 'bg-pitch-800 text-pitch-200 ring-pitch-700',
  warn: 'bg-down/15 text-down ring-down/60',
  off: 'bg-pitch-900 text-pitch-400 ring-pitch-700',
};
const DOT: Record<StatusChip['tone'], string> = { ok: 'bg-up', info: 'bg-pitch-400', warn: 'bg-down', off: 'bg-pitch-600' };

export function Chip({ chip }: { chip: StatusChip }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.85rem] font-medium ring-1 ${CHIP_TONE[chip.tone]}`}>
      {chip.tone === 'warn' ? <Icon name="warn" className="h-4 w-4" /> : <span className={`h-2 w-2 rounded-full ${DOT[chip.tone]}`} />}
      {chip.label}
    </span>
  );
}

/* ---------------- Animated percentage ---------------- */

/** A number that flashes up-blue / down-orange and slides when it changes (color + arrow, never color alone). */
export function AnimatedPct({ value, className = '', showArrow = true }: { value: number; className?: string; showArrow?: boolean }) {
  const pct = Math.round(value * 100);
  const prev = useRef(pct);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (pct === prev.current) return;
    setDir(pct > prev.current ? 'up' : 'down');
    prev.current = pct;
    const t = setTimeout(() => setDir(null), 1200);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <span className={`tabular relative inline-flex items-baseline ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={pct}
          initial={{ y: dir === 'down' ? '-0.35em' : '0.35em', opacity: 0 }}
          animate={{ y: 0, opacity: 1, color: dir === 'up' ? '#38BDF8' : dir === 'down' ? '#FF9F1C' : 'currentColor' }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        >
          {pct}
        </motion.span>
      </AnimatePresence>
      <span className="ml-[0.04em] text-[0.55em] opacity-80">%</span>
      {showArrow && dir && (
        <Icon
          name={dir}
          className={`ml-[0.12em] h-[0.38em] w-[0.38em] self-center ${dir === 'up' ? 'text-up' : 'text-down'}`}
          aria-label={dir === 'up' ? 'price up' : 'price down'}
        />
      )}
    </span>
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
  return <div key={n} className={`led-ring led-${led.pattern}`} style={{ ['--led' as string]: led.color }} aria-hidden />;
}

/* ---------------- Toast ---------------- */

export function ToastHost() {
  const toast = useBox((s) => s.toast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.6rem] z-[70] flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-[1.05rem] font-semibold shadow-card ${
              toast.tone === 'error'
                ? 'bg-down text-down-ink'
                : toast.tone === 'ok'
                  ? 'bg-volt text-volt-ink'
                  : 'bg-pitch-700 text-pitch-50'
            }`}
            role="status"
          >
            <Icon name={toast.tone === 'error' ? 'warn' : 'check'} className="h-5 w-5" />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
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
}: {
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'md' | 'lg';
  /** Adds data-testid="<prefix>-<value>" to each option (e2e hooks, see e2e/README.md). */
  testIdPrefix?: string;
}) {
  return (
    <div
      className={`grid gap-2 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={on}
            data-testid={testIdPrefix ? `${testIdPrefix}-${String(o.value)}` : undefined}
            onClick={() => onChange(o.value)}
            className={`flex flex-col items-start justify-center rounded-xl px-3 text-left ring-1 transition active:scale-[0.98] ${
              size === 'lg' ? 'min-h-[4.2rem] py-2' : 'min-h-[3rem] py-1.5'
            } ${on ? 'bg-volt text-volt-ink ring-volt' : 'bg-pitch-800 text-pitch-50 ring-pitch-700'}`}
          >
            <span className="font-display text-[1.3rem] font-semibold uppercase leading-tight tracking-wide">{o.label}</span>
            {o.sub && <span className={`text-[0.72rem] leading-snug ${on ? 'text-volt-ink/80' : 'text-pitch-400'}`}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[3rem] w-full items-center justify-between gap-3 rounded-xl bg-pitch-800 px-4 ring-1 ring-pitch-700"
    >
      <span className="text-left text-[0.95rem] font-medium">{label}</span>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? 'bg-volt' : 'bg-pitch-600'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-pitch-950 transition-all ${on ? 'left-7' : 'left-1'}`} />
      </span>
    </button>
  );
}
