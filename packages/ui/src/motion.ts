import { useEffect, useState } from 'react';

/**
 * Motion tokens (mirrored as CSS variables in styles.css). Durations in ms.
 * Rule: the resting style is the final state; animation only describes the journey there. Anything
 * that starts invisible is a CSS animation (time-based, finishes even in a background tab), never a
 * JS-driven `initial={{ opacity: 0 }}`.
 */
export const DUR = {
  instant: 90,
  quick: 160,
  base: 240,
  slow: 420,
  linger: 700,
  reveal: 1200,
} as const;

export const EASE = {
  /** Entrances, numbers settling. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Exits. */
  in: [0.55, 0, 1, 0.45] as const,
  /** The lock: hard in, hard stop. */
  snap: [0.85, 0, 0.15, 1] as const,
  /** Small overshoot for stamps (win amount, score change). */
  swing: [0.34, 1.4, 0.64, 1] as const,
};

/** framer-motion springs, for layout reorders only. */
export const SPRING = {
  /** Leaderboard rows, lobby tiles. */
  reorder: { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 } as const,
  /** Sheets and panels. */
  panel: { type: 'spring', stiffness: 420, damping: 40 } as const,
};

const query = '(prefers-reduced-motion: reduce)';

/** True when the user asked for reduced motion. Safe on the server (false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Live `prefers-reduced-motion` value. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/**
 * Restartable one-shot CSS animation: returns a class that alternates between `${base}-a` and
 * `${base}-b` each time `trigger` changes (same keyframes, new name, so the browser replays it
 * without remounting). Returns '' until the first change, so nothing animates on first paint.
 */
export function useReplayClass(trigger: unknown, base: string): string {
  const [state, setState] = useState<{ last: unknown; n: number }>({ last: trigger, n: 0 });
  if (state.last !== trigger) setState({ last: trigger, n: state.n + 1 });
  return state.n === 0 ? '' : `${base}-${state.n % 2 ? 'a' : 'b'}`;
}

/** Direction of the last change of a number: 'up' | 'down' | null, cleared after `holdMs`. */
export function useDirection(value: number | null | undefined, holdMs = 1100): 'up' | 'down' | null {
  const [state, setState] = useState<{ prev: number | null | undefined; dir: 'up' | 'down' | null; n: number }>({
    prev: value,
    dir: null,
    n: 0,
  });
  if (value !== state.prev) {
    const dir =
      typeof value === 'number' && typeof state.prev === 'number' && Number.isFinite(value) && Number.isFinite(state.prev)
        ? value > state.prev
          ? 'up'
          : value < state.prev
            ? 'down'
            : null
        : null;
    setState({ prev: value, dir, n: state.n + 1 });
  }
  useEffect(() => {
    if (!state.dir) return;
    const t = setTimeout(() => setState((s) => ({ ...s, dir: null })), holdMs);
    return () => clearTimeout(t);
  }, [state.n, state.dir, holdMs]);
  return state.dir;
}
