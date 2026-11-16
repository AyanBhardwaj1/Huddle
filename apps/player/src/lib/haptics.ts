/** Light haptic feedback where supported (Android Chrome); a silent no-op elsewhere (iOS Safari). */
export function buzz(pattern: number | readonly number[] = 12): void {
  try {
    navigator.vibrate?.(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    /* unsupported */
  }
}

export const HAPTIC = {
  tap: 10,
  success: [14, 40, 22],
  error: [40, 30, 40],
  win: [20, 50, 20, 50, 60],
} as const;
