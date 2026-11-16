import type { ButtonId } from '@huddle/shared';

export interface KeyboardOptions {
  press: (id: ButtonId, action: 'down' | 'up') => void;
  quit: () => void;
  log?: (line: string) => void;
  tapMs?: number;
}

/**
 * Map a key to a button gesture. L / N: tap (down, then up after `tapMs`).
 * T: hold-style push-to-talk toggle (first press = down, second = up).
 * Returns a function that handles one keypress string; exported for tests.
 */
export function createKeyHandler(opts: KeyboardOptions): (key: string) => void {
  const tapMs = opts.tapMs ?? 150;
  const log = opts.log ?? (() => {});
  let talkDown = false;
  const tap = (id: ButtonId) => {
    opts.press(id, 'down');
    setTimeout(() => opts.press(id, 'up'), tapMs);
  };
  return (key: string) => {
    if (key === '\u0003' || key === 'q' || key === 'Q') return opts.quit(); // Ctrl-C / Q
    switch (key.toLowerCase()) {
      case 'l':
        return tap('lock');
      case 'n':
        return tap('next');
      case 't':
        talkDown = !talkDown;
        log(talkDown ? '[key] TALK held — press T again to release' : '[key] TALK released');
        return opts.press('talk', talkDown ? 'down' : 'up');
    }
  };
}

/** Raw-mode stdin key handling; no-op (returns false) when stdin is not a TTY. */
export function attachKeyboard(opts: KeyboardOptions): boolean {
  const stdin = process.stdin;
  if (!stdin.isTTY) return false;
  const handle = createKeyHandler(opts);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    for (const ch of chunk) handle(ch);
  });
  return true;
}

export function detachKeyboard(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
