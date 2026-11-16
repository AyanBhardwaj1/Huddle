import { animate, AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ctx';
import { Icon } from './Icon';

/** A number that tweens to its new value and flashes up (cyan) or down (orange) on change. */
export function Ticker({
  value,
  format,
  className,
  flash = true,
}: {
  value: number;
  format: (v: number) => string;
  className?: string;
  flash?: boolean;
}) {
  const [display, setDisplay] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (flash) setDir(value > from ? 'up' : 'down');
    const ctl = animate(from, value, { duration: 0.5, ease: 'easeOut', onUpdate: setDisplay });
    const t = setTimeout(() => setDir(null), 900);
    return () => {
      ctl.stop();
      clearTimeout(t);
      setDisplay(value);
    };
  }, [value, flash]);
  return (
    <span
      className={cx('tnum inline-block transition-colors duration-700', className)}
      style={dir ? { color: dir === 'up' ? '#38BDF8' : '#FF9F1C', transitionDuration: '0ms' } : undefined}
    >
      {format(display)}
    </span>
  );
}

/** Circular lock countdown. */
export function CountdownRing({ fraction, secs, urgent, size = 44 }: { fraction: number; secs: number; urgent: boolean; size?: number }) {
  const r = size / 2 - 3.5;
  const c = 2 * Math.PI * r;
  const label = secs >= 100 ? `${Math.ceil(secs / 60)}m` : String(secs);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${secs} seconds to lock`}>
      {urgent && secs > 0 && <span className="absolute inset-0 rounded-full border-2 border-live animate-pulse-ring" />}
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1E2633" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? '#FF4D5E' : '#D4FF3A'}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
        />
      </svg>
      <span
        className={cx(
          'absolute inset-0 grid place-items-center font-display font-bold tnum',
          size >= 44 ? 'text-lg' : 'text-sm',
          urgent ? 'text-live' : 'text-pitch-50',
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** Bottom sheet: slides up, drag the handle (or tap outside) to dismiss. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  dismissable?: boolean;
}) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissable && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dismissable && onClose()}
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border-t border-pitch-700 bg-pitch-900 px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-card"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 380 }}
            drag={dismissable ? 'y' : false}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => (info.offset.y > 90 || info.velocity.y > 500) && onClose()}
          >
            <div className="sticky top-0 -mx-5 bg-pitch-900 px-5 pt-3" onPointerDown={(e) => dismissable && drag.start(e)} style={{ touchAction: 'none' }}>
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-pitch-600" />
              {title && (
                <div className="flex items-center justify-between pb-3">
                  <h2 className="font-display text-2xl font-bold uppercase tracking-wide">{title}</h2>
                  {dismissable && (
                    <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full text-pitch-400 active:bg-pitch-800" aria-label="Close">
                      <Icon name="x" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const CONFETTI_COLORS = ['#D4FF3A', '#38BDF8', '#FF9F1C', '#8B7CFF', '#F4F7FB'];

/** A one-shot confetti burst from the center of its parent. */
export function Confetti({ count = 28 }: { count?: number }) {
  const [bits] = useState(() =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 110 + Math.random() * 120;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 40,
        r: Math.random() * 540 - 270,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 6 + Math.random() * 6,
        delay: Math.random() * 0.08,
      };
    }),
  );
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-visible" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[2px]"
          style={{ width: b.w, height: b.w * 0.45, background: b.color }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 160], rotate: b.r, opacity: [1, 1, 0] }}
          transition={{ duration: 1.6, delay: b.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Small uppercase pill. */
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', className)}>
      {children}
    </span>
  );
}
