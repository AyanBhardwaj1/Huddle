import { createElement, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* ------------------------------------------------------------------ kinetic type */

/**
 * Kinetic text: every word rises out of its own baseline mask with a springy stagger (CSS, so it
 * finishes in a background tab and is instant under reduced motion). The words stay real text with
 * real spaces, so wrapping, `line-clamp`, copy and screen readers behave as for plain text.
 * Change `text` (or `replay`) to play it again.
 */
export function Kinetic({
  text,
  as = 'span',
  className = '',
  style,
  delay = 0,
  stagger = 55,
  replay,
  id,
}: {
  text: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
  style?: CSSProperties;
  /** ms before the first word. */
  delay?: number;
  /** ms between words. */
  stagger?: number;
  /** Extra key to replay the same text. */
  replay?: unknown;
  id?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  // Assistive tech (and text search) get the sentence once; the animated words are presentation.
  const children: ReactNode[] = [
    <span key="sr" className="hd-sr">
      {text}
    </span>,
  ];
  const shown: ReactNode[] = [];
  words.forEach((w, i) => {
    if (i > 0) shown.push(' ');
    shown.push(
      <span key={i} className="hd-wm">
        <span className="hd-w" style={{ ['--wi' as string]: i } as CSSProperties}>
          {w}
        </span>
      </span>,
    );
  });
  children.push(
    <span key="words" aria-hidden="true">
      {shown}
    </span>,
  );
  return createElement(
    as,
    {
      key: `${text}|${String(replay ?? '')}`,
      id,
      className: `hd-words ${className}`,
      style: { ...style, ['--d' as string]: `${delay}ms`, ['--ws' as string]: `${stagger}ms` } as CSSProperties,
    },
    children,
  );
}

/* ------------------------------------------------------------------ confetti */

const BURST_COLOURS = ['#6C2BFF', '#FF2E93', '#FFB020', '#1468FF', '#FFC83D', '#B9A8FF', '#FF6B00'];

/** Small deterministic PRNG so a burst looks the same on every render of the same seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * A one-shot confetti burst, sized to the moment (`count` 12 for a friend's win, 40+ for yours).
 * Decorative: aria-hidden, hidden under reduced motion, transform/opacity only. Place it in a
 * `position: relative` parent; `x`/`y` are the origin inside it. Change `seed` to fire again.
 */
export function Burst({
  count = 24,
  seed = 1,
  colours = BURST_COLOURS,
  x = '50%',
  y = '50%',
  spread = 14,
  delay = 0,
}: {
  count?: number;
  seed?: number;
  colours?: string[];
  x?: string;
  y?: string;
  /** Radius of the burst in rem. */
  spread?: number;
  delay?: number;
}) {
  const bits = useMemo(() => {
    const r = rng(seed * 9301 + count);
    return Array.from({ length: count }, (_, i) => {
      const a = r() * Math.PI * 2;
      const d = spread * (0.35 + r() * 0.65);
      const long = r() > 0.5;
      return {
        i,
        x: `${(Math.cos(a) * d).toFixed(2)}rem`,
        y: `${(Math.sin(a) * d * 0.75 - spread * 0.25).toFixed(2)}rem`,
        r: `${Math.round((r() - 0.5) * 1080)}deg`,
        c: colours[i % colours.length]!,
        w: long ? '0.45rem' : '0.6rem',
        h: long ? '1rem' : '0.6rem',
        br: long ? '2px' : '999px',
        dur: `${1100 + Math.round(r() * 700)}ms`,
        d: `${delay + Math.round(r() * 120)}ms`,
        fall: `${(3 + r() * 6).toFixed(1)}rem`,
      };
    });
  }, [seed, count, spread, delay, colours]);
  return (
    <span key={seed} className="hd-burst" style={{ ['--bx' as string]: x, ['--by' as string]: y } as CSSProperties} aria-hidden="true">
      {bits.map((b) => (
        <i
          key={b.i}
          className="hd-bit"
          style={
            {
              '--x': b.x,
              '--y': b.y,
              '--r': b.r,
              '--c': b.c,
              '--w': b.w,
              '--h': b.h,
              '--br': b.br,
              '--dur': b.dur,
              '--d': b.d,
              '--fall': b.fall,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ ambient field */

export interface AuroraBlob {
  /** CSS colour at the blob's centre (use alpha 0.15-0.35 on the light canvas). */
  c: string;
  x: string;
  y: string;
  s?: string;
  mx?: string;
  my?: string;
  dur?: string;
  d?: string;
}

const AURORA_DEFAULT: AuroraBlob[] = [
  { c: 'rgba(108,43,255,0.20)', x: '-12vmax', y: '-18vmax', s: '62vmax', mx: '10vmax', my: '6vmax', dur: '26s' },
  { c: 'rgba(255,46,147,0.16)', x: '48vw', y: '30vh', s: '56vmax', mx: '-8vmax', my: '-6vmax', dur: '30s', d: '-6s' },
  { c: 'rgba(20,104,255,0.14)', x: '10vw', y: '55vh', s: '50vmax', mx: '9vmax', my: '-4vmax', dur: '34s', d: '-12s' },
];

/**
 * Slow drifting colour field for the light canvas (home, lobby, takeover backdrops). Radial
 * gradients moved by transform only, so it is cheap on the box's GPU; static under reduced motion.
 */
export function Aurora({ blobs = AURORA_DEFAULT, className = '' }: { blobs?: AuroraBlob[]; className?: string }) {
  return (
    <div className={`hd-aurora ${className}`} aria-hidden="true">
      {blobs.map((b, i) => (
        <i
          key={i}
          style={
            {
              '--c': b.c,
              '--x': b.x,
              '--y': b.y,
              '--s': b.s,
              '--mx': b.mx,
              '--my': b.my,
              '--dur': b.dur,
              '--d': b.d,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ people */

/** Avatar fills: vivid, each with a text colour that passes 4.5:1. Never the YES/NO hues. */
const AVATAR: { bg: string; fg: string }[] = [
  { bg: '#6C2BFF', fg: '#FFFFFF' },
  { bg: '#FF2E93', fg: '#14123A' },
  { bg: '#FFB020', fg: '#14123A' },
  { bg: '#14123A', fg: '#FFFFFF' },
  { bg: '#B9A8FF', fg: '#14123A' },
  { bg: '#FFC83D', fg: '#14123A' },
  { bg: '#A41FD0', fg: '#FFFFFF' },
  { bg: '#2BD9C4', fg: '#14123A' },
];

export function avatarColour(name: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length]!;
}

/** A player's squircle with their initial, coloured from their name. Decorative (the name is next to it). */
export function Avatar({ name, size = '2.5rem', className = '' }: { name: string; size?: string; className?: string }) {
  const { bg, fg } = avatarColour(name);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-extrabold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: `calc(${size} * 0.34)`,
        background: bg,
        color: fg,
        fontSize: `calc(${size} * 0.48)`,
        fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif",
        boxShadow: `inset 0 calc(${size} * -0.06) 0 rgba(20,18,58,0.18)`,
      }}
      aria-hidden="true"
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/* ------------------------------------------------------------------ price history */

export interface SeriesPoint {
  t: number;
  p: number;
}

/**
 * A live series for one value (a market's price): seeded from history (e.g. derived from fills),
 * then a point is appended whenever `value` changes. Keyed by `key` so a new market starts fresh.
 * Capped at `max` points.
 */
export function useSeries(key: string, value: number | null | undefined, seed: SeriesPoint[] = [], max = 120): SeriesPoint[] {
  // Derived during render (idempotent, so StrictMode's double render cannot add a point twice).
  const ref = useRef<{ key: string; pts: SeriesPoint[] }>({ key: '', pts: [] });
  if (ref.current.key !== key) {
    ref.current = { key, pts: seed.slice(-max) };
  }
  const pts = ref.current.pts;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.p - value) > 1e-6) {
      ref.current.pts = [...pts, { t: Date.now(), p: value }].slice(-max);
    }
  }
  return ref.current.pts;
}

/**
 * Price history line, drawn on as it updates (the new segment reveals with a sliding window,
 * transform only). Auto-scaled with a minimum 10-point range so noise does not look like a crash.
 * Pair with text that says the numbers (start, now, change); the chart itself is aria-hidden.
 */
export function Sparkline({
  points,
  className = '',
  stroke = 'var(--k-zap)',
  fill = 'rgba(108,43,255,0.12)',
  dot = true,
}: {
  points: SeriesPoint[];
  className?: string;
  stroke?: string;
  fill?: string;
  dot?: boolean;
}) {
  const n = points.length;
  const [drawn, setDrawn] = useState<{ n: number; flip: boolean; from: number }>({ n: 0, flip: false, from: 0 });
  if (drawn.n !== n) setDrawn({ n, flip: !drawn.flip, from: drawn.n <= 1 || n <= 1 ? 0 : (drawn.n - 1) / (n - 1) });
  if (n === 0) return <div className={className} aria-hidden="true" />;
  const ps = points.map((x) => x.p);
  let lo = Math.min(...ps);
  let hi = Math.max(...ps);
  if (hi - lo < 0.1) {
    const mid = (hi + lo) / 2;
    lo = Math.max(0, mid - 0.05);
    hi = Math.min(1, lo + 0.1);
    lo = hi - 0.1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const X = (i: number) => (n === 1 ? 100 : (i / (n - 1)) * 100);
  const Y = (p: number) => 100 - ((p - lo) / (hi - lo)) * 100;
  // Stepped line: prices hold until the next trade, like a real order book chart.
  let d = `M 0 ${Y(ps[0]!).toFixed(2)}`;
  for (let i = 1; i < n; i++) d += ` H ${X(i).toFixed(2)} V ${Y(ps[i]!).toFixed(2)}`;
  if (n === 1) d += ` H 100`;
  const area = `${d} V 100 H 0 Z`;
  const lastY = Y(ps[n - 1]!);
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <div
        className={`hd-spark-win h-full w-full ${drawn.flip ? 'hd-spark-draw-a' : 'hd-spark-draw-b'}`}
        style={{ ['--from' as string]: String(drawn.from) } as CSSProperties}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hd-spark h-full w-full">
          <path d={area} fill={fill} stroke="none" />
          <path d={d} fill="none" stroke={stroke} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      {dot && (
        <svg
          viewBox="0 0 10 10"
          className="pointer-events-none absolute right-0 h-[0.7em] w-[0.7em] -translate-y-1/2 translate-x-1/2 overflow-visible"
          style={{ top: `${lastY}%`, transition: 'top 0ms' }}
        >
          <circle cx="5" cy="5" r="3.2" fill={stroke} className="hd-ping" />
          <circle cx="5" cy="5" r="3.2" fill={stroke} stroke="#fff" strokeWidth="1.4" />
        </svg>
      )}
    </div>
  );
}
