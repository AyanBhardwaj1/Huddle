import type { LedPattern } from '@huddle/shared';

const RING_SIZE = 12;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Brightness per LED for a still frame of each pattern, 0..1. */
function frame(pattern: LedPattern, i: number): number {
  switch (pattern) {
    case 'idle':
      return 0.35;
    case 'join':
    case 'win':
      return i % 2 === 0 ? 1 : 0.55; // chase
    case 'market_open':
      return 0.85;
    case 'locking':
      return i % 3 === 0 ? 1 : 0.4;
    case 'locked':
    case 'goal':
    case 'error':
      return 1;
    case 'loss':
      return Math.max(0.15, 1 - i / RING_SIZE); // fading tail
  }
}

/** One-line terminal preview: a ring of truecolor blocks in the command's color + the pattern name. */
export function ledPreview(pattern: LedPattern, color: string, opts: { color?: boolean } = {}): string {
  const useColor = opts.color ?? true;
  const [r, g, b] = hexToRgb(color);
  let ring = '';
  for (let i = 0; i < RING_SIZE; i++) {
    const k = frame(pattern, i);
    const block = '●';
    ring += useColor ? `\x1b[38;2;${Math.round(r * k)};${Math.round(g * k)};${Math.round(b * k)}m${block}\x1b[0m` : block;
  }
  return `[led] (${ring}) ${pattern.padEnd(11)} ${color.toUpperCase()}`;
}
