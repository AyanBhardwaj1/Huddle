import { Aurora, Avatar as UiAvatar, Icon, Kinetic, Mark, Roll } from '@huddle/ui';
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { money, pnl } from '../lib/money';
import { cx } from './ctx';

const canPortal = () => typeof document !== 'undefined';

/** Money that rolls digit by digit and flashes the direction it moved (odds-roll, for money). */
export function Money({
  value,
  points,
  signed = false,
  className,
  flash = true,
  arrow = false,
  duration,
}: {
  value: number;
  points: boolean;
  signed?: boolean;
  className?: string;
  flash?: boolean;
  arrow?: boolean;
  /** Roll duration in ms: short for ticks, long for a payout landing. */
  duration?: number;
}) {
  const text = signed ? pnl(value, points) : money(value, points);
  return <Roll text={text} value={value} label={text} className={cx('font-num tnum', className)} flash={flash} arrow={arrow} duration={duration} />;
}

/** The ring spinning with three lit pixels + a line that says what is happening. */
export function Loading({ children, className }: { children?: ReactNode; className?: string }) {
  // A hosted engine on a free plan can take up to a minute to wake: say so instead of spinning silently.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={cx('flex items-center gap-3 text-ink-2', className)} role="status">
      <Mark size="1.6rem" spin lit={3} className="shrink-0 text-rule-strong" />
      <span>
        {children}
        {slow && <span className="block text-small text-ink-muted">Waking up the engine. This can take up to a minute.</span>}
      </span>
    </div>
  );
}

/** Inline error: what happened and what to do, on a hot-50 field with a hot ring and an icon. */
export function InlineError({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="hd-rise mt-3 flex items-start gap-2.5 rounded-tile bg-hot-50 px-3.5 py-3 text-small text-ink ring-1 ring-inset ring-hot" role="alert">
      <Icon name="warn" size={18} className="mt-px shrink-0 text-hot-600" />
      <span className="min-w-0 flex-1 text-pretty">{text}</span>
      {action}
    </div>
  );
}

/** Section heading on the live screen: Bricolage, sentence case, a count pill beside it. */
export function SectionTitle({ children, count, id }: { children: ReactNode; count?: number; id?: string }) {
  return (
    <h2 id={id} className="mb-3 flex items-center gap-2 font-head text-lead font-extrabold tracking-[-0.02em] text-ink">
      {children}
      {count != null && count > 1 && (
        <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-zap-100 px-1.5 text-small text-zap-deep">{count}</span>
      )}
    </h2>
  );
}

/** Empty state: a dashed card that says what happens next. */
export function Empty({ children, mark = false }: { children: ReactNode; mark?: boolean }) {
  return (
    <div className="hd-fade flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-rule px-6 py-9 text-center">
      {mark && <Mark size="2.5rem" lit={2} className="hd-float text-rule-strong" />}
      <p className="max-w-[30ch] text-pretty text-body text-ink-muted">{children}</p>
    </div>
  );
}

/** "#E4002B" + alpha -> "rgba(228,0,43,a)"; anything else passes through. */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The drifting colour field behind a screen (fixed, decorative, static under reduced motion).
 * Pass the two team colours during an open moment market, as the box does; default blobs otherwise.
 */
export function Backdrop({ teams }: { teams?: [string | undefined, string | undefined] }) {
  const [home, away] = teams ?? [];
  const blobs =
    home || away
      ? [
          { c: withAlpha(home ?? '#6C2BFF', 0.2), x: '-20vmax', y: '-14vmax', s: '64vmax', mx: '10vmax', my: '8vmax', dur: '18s' },
          { c: withAlpha(away ?? '#FF2E93', 0.2), x: '40vw', y: '40vh', s: '60vmax', mx: '-9vmax', my: '-7vmax', dur: '22s', d: '-5s' },
          { c: 'rgba(108,43,255,0.12)', x: '20vw', y: '10vh', s: '40vmax', mx: '6vmax', my: '5vmax', dur: '26s', d: '-9s' },
        ]
      : undefined;
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <Aurora key={blobs ? 'teams' : 'default'} blobs={blobs} className="hd-fade" />
    </div>
  );
}

/** A player's squircle with their initial, coloured from their name (Kickoff `Avatar`). */
export function Avatar({ name, className, size = '2.25rem' }: { name: string; className?: string; size?: string }) {
  return <UiAvatar name={name} size={size} className={className} />;
}

/**
 * Bottom sheet. Rises in with a CSS keyframe (open is the resting state, so it can never get stuck
 * hidden) and unmounts at once on close. Drag the handle down, tap outside or press Escape to close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dismissable = true,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  dismissable?: boolean;
  /** Accessible name when there is no visible title. */
  label?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissable && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setDy(0);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-panel">
      <div className="hd-fade absolute inset-0 bg-ink/40" onClick={() => dismissable && onClose()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        data-dragging={String(dragging)}
        className="pl-sheet absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-blob bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-pop outline-none"
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          className="sticky top-0 z-10 -mx-5 bg-card px-5 pt-2.5"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            if (!dismissable || (e.target as HTMLElement).closest('button')) return;
            drag.current = { y0: e.clientY, id: e.pointerId };
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!drag.current || drag.current.id !== e.pointerId) return;
            setDy(Math.max(0, e.clientY - drag.current.y0));
          }}
          onPointerUp={() => {
            if (!drag.current) return;
            drag.current = null;
            setDragging(false);
            if (dy > 90) onClose();
            else setDy(0);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
            setDy(0);
          }}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-rule-strong" aria-hidden="true" />
          {title ? (
            <div className="flex min-h-12 items-center justify-between gap-3 pb-2">
              {typeof title === 'string' ? (
                <Kinetic as="h2" id={titleId} text={title} className="q text-title" stagger={40} />
              ) : (
                <h2 id={titleId} className="q text-title">
                  {title}
                </h2>
              )}
              {dismissable && (
                <button onClick={onClose} className="btn-quiet -mr-2 min-h-11 w-11 shrink-0 px-0" aria-label="Close">
                  <Icon name="x" size={22} />
                </button>
              )}
            </div>
          ) : (
            <div className="h-2" />
          )}
        </div>
        {children}
      </div>
    </div>
  );
  return canPortal() ? createPortal(node, document.body) : node;
}

interface Coin {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  d: number;
}

/**
 * money-flow: coins travel from one element to another (buy-in: you to the pot; payout: the pot to
 * you). Purely decorative CSS (`hd-coin`), hidden under reduced motion; numbers roll on their own.
 */
export function useCoins(): [ReactNode, (from: Element | null, to: Element | null, n?: number) => void] {
  const [coins, setCoins] = useState<Coin[]>([]);
  const seq = useRef(0);
  const fire = useCallback((from: Element | null, to: Element | null, n = 6) => {
    if (!from || !to) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const batch = Array.from({ length: n }, (_, i) => ({
      id: ++seq.current,
      x: ax + (i - n / 2) * 7,
      y: ay + (i % 2 ? 4 : -4),
      dx: bx - ax - (i - n / 2) * 7,
      dy: by - ay,
      d: i * 70,
    }));
    setCoins((c) => [...c, ...batch]);
    const ids = new Set(batch.map((c) => c.id));
    setTimeout(() => setCoins((c) => c.filter((x) => !ids.has(x.id))), 900 + n * 70 + 200);
  }, []);
  const layer =
    coins.length && canPortal()
      ? createPortal(
          <div className="pointer-events-none fixed inset-0 z-toast" aria-hidden="true">
            {coins.map((c) => (
              <span
                key={c.id}
                className="hd-coin"
                style={{ left: c.x - 6, top: c.y - 6, fontSize: 17, ['--dx' as string]: `${c.dx}px`, ['--dy' as string]: `${c.dy}px`, ['--d' as string]: `${c.d}ms` } as CSSProperties}
              />
            ))}
          </div>,
          document.body,
        )
      : null;
  return [layer, fire];
}
