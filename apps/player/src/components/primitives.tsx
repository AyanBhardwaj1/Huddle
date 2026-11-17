import { Icon, Mark, Roll } from '@huddle/ui';
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
}: {
  value: number;
  points: boolean;
  signed?: boolean;
  className?: string;
  flash?: boolean;
  arrow?: boolean;
}) {
  const text = signed ? pnl(value, points) : money(value, points);
  return <Roll text={text} value={value} label={text} className={cx('font-display tnum', className)} flash={flash} arrow={arrow} />;
}

/** Ring spinner + a line that says what is happening. */
export function Loading({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 text-night-200', className)} role="status">
      <Mark size="1.5rem" spin className="shrink-0 text-night-400" />
      <span>{children}</span>
    </div>
  );
}

/** Inline error: what happened and what to do, chalk on a no-deep field, never colour alone. */
export function InlineError({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="hd-fade mt-3 flex items-start gap-2.5 rounded-tile bg-no-deep px-3.5 py-3 text-small text-chalk" role="alert">
      <Icon name="warn" size={18} className="mt-px shrink-0 text-no" />
      <span className="min-w-0 flex-1 text-pretty">{text}</span>
      {action}
    </div>
  );
}

/** Section heading on the live screen: sentence case, a count whispering beside it. */
export function SectionTitle({ children, count, id }: { children: ReactNode; count?: number; id?: string }) {
  return (
    <h2 id={id} className="mb-3 flex items-baseline gap-2 font-display text-lead font-bold stretch-semi text-chalk">
      {children}
      {count != null && count > 1 && <span className="font-sans text-small font-normal text-night-400 tnum">{count}</span>}
    </h2>
  );
}

/** Empty state: a composed line that says what happens next. */
export function Empty({ children, mark = false }: { children: ReactNode; mark?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {mark && <Mark size="2.5rem" className="hd-breathe text-night-600" />}
      <p className="max-w-[30ch] text-pretty text-body text-night-400">{children}</p>
    </div>
  );
}

/** Initial in a rounded square (people are tiles here, not circles). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-tile bg-night-800 font-display text-body font-extrabold uppercase text-night-200',
        className,
      )}
      aria-hidden="true"
    >
      {name.trim().slice(0, 1) || '?'}
    </span>
  );
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
      <div className="hd-fade absolute inset-0 bg-night-950/75" onClick={() => dismissable && onClose()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        data-dragging={String(dragging)}
        className="pl-sheet absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-panel bg-night-900 px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-float outline-none"
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          className="sticky top-0 z-10 -mx-5 bg-night-900 px-5 pt-2.5"
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
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-night-600" aria-hidden="true" />
          {title ? (
            <div className="flex min-h-12 items-center justify-between gap-3 pb-2">
              <h2 id={titleId} className="font-display text-title font-extrabold stretch-semi">
                {title}
              </h2>
              {dismissable && (
                <button onClick={onClose} className="btn-quiet -mr-2 w-11 px-0" aria-label="Close">
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
