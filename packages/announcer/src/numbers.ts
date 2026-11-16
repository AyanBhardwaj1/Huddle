/**
 * Number helpers shared by the line validator ("never invent numbers"), the TALK parser ("five bucks on
 * Portugal") and the speech normaliser. No dependencies, deterministic.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

const SMALL: Record<string, number> = Object.fromEntries(ONES.map((w, i) => [w, i]));
const TENS_W: Record<string, number> = { fourty: 40 };
TENS.forEach((w, i) => {
  if (w) TENS_W[w] = i * 10;
});

/** 0..999 -> "twenty-five". Larger or non-integer numbers are returned as digits. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!;
    return n % 10 === 0 ? t : `${t}-${ONES[n % 10]!}`;
  }
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]!} hundred${rest ? ` ${numberToWords(rest)}` : ''}`;
}

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

interface NumberRun {
  value: number;
  /** Index of the first token after the run. */
  next: number;
  words: number;
}

/** Parse one spoken number starting at word token `start` ("three hundred and twenty five"). */
function readNumber(tokens: string[], start: number): NumberRun | null {
  const word = (k: number): string | null => {
    const t = tokens[k];
    return t !== undefined && /^[A-Za-z]+$/.test(t) ? t.toLowerCase() : null;
  };
  /** The word after token k, when only spaces or a hyphen separate them. */
  const nextWord = (k: number): string | null => (/^[ \t-]+$/.test(tokens[k + 1] ?? '') ? word(k + 2) : null);
  const isSmall = (w: string | null): w is string => w !== null && w in SMALL;
  const isTens = (w: string | null): w is string => w !== null && w in TENS_W;
  const isDigit = (w: string | null): w is string => isSmall(w) && SMALL[w]! >= 1 && SMALL[w]! <= 9;

  let cur = start;
  let w = word(cur);
  if (w === null) return null;
  let value = 0;
  let words = 0;
  let hundreds = false;

  if ((w === 'a' || isDigit(w)) && nextWord(cur) === 'hundred') {
    value = (w === 'a' ? 1 : SMALL[w]!) * 100;
    words = 2;
    cur += 2;
    hundreds = true;
  } else if (w === 'hundred') {
    value = 100;
    words = 1;
    hundreds = true;
  }
  if (hundreds) {
    let k = cur;
    let n = nextWord(k);
    if (n === 'and') {
      k += 2;
      n = nextWord(k);
    }
    if (!isSmall(n) && !isTens(n)) return { value, next: cur + 1, words };
    cur = k + 2;
    w = n;
  }
  if (isTens(w)) {
    value += TENS_W[w]!;
    words += 1;
    const n = nextWord(cur);
    if (isDigit(n)) {
      value += SMALL[n]!;
      words += 1;
      cur += 2;
    }
  } else if (isSmall(w)) {
    value += SMALL[w]!;
    words += 1;
  } else {
    return null;
  }
  return { value, next: cur + 1, words };
}

/**
 * Replace spoken numbers with digits: "twenty five bucks on seven" -> "25 bucks on 7".
 * A lone "one" is only converted when `convertOne` is set ("that one is off" must stay as it is).
 * "a hundred" -> 100. Hyphenated forms work ("twenty-five").
 */
export function wordsToDigits(text: string, opts: { convertOne?: boolean } = {}): string {
  const tokens = text.match(/[A-Za-z]+|[^A-Za-z]+/g) ?? [];
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const run = readNumber(tokens, i);
    const lone = run && run.words === 1 ? tokens[i]!.toLowerCase() : '';
    if (!run || (lone === 'one' && !opts.convertOne)) {
      out.push(tokens[i]!);
      i += 1;
      continue;
    }
    out.push(String(run.value));
    i = run.next;
  }
  return out.join('');
}

/** Every numeric value written in digits: "77%, $1 pays $1.30, 2-1" -> [77, 1, 1.3, 2, 1]. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Numbers said in a line, whether as digits or as words ("twenty seconds" -> 20). "one" alone is ignored. */
export function spokenNumbers(text: string): number[] {
  return extractNumbers(wordsToDigits(text));
}

/**
 * Turn a caption into text a TTS model reads well without relying on server-side normalisation
 * (which the low-latency models skip): "$14.20" -> "14 dollars 20", "77%" -> "77 percent",
 * "8 pts" -> "8 points", "2-1" -> "2 1" (soccer) or "2 to 1" (NFL).
 */
export function speakable(text: string, sport: 'soccer' | 'nfl' = 'soccer'): string {
  let s = text;
  s = s.replace(/([+-])?\$(\d+)(?:\.(\d{2}))?/g, (_m, sign: string | undefined, whole: string, cents: string | undefined) => {
    const prefix = sign === '-' ? 'minus ' : sign === '+' ? 'plus ' : '';
    const unit = whole === '1' && (!cents || cents === '00') ? 'dollar' : 'dollars';
    const c = cents && cents !== '00' ? ` ${Number(cents)}` : '';
    return `${prefix}${whole} ${unit}${c}`;
  });
  s = s.replace(/(\d+(?:\.\d+)?)\s*pts\b/g, (_m, n: string) => `${Number(n)} ${Number(n) === 1 ? 'point' : 'points'}`);
  s = s.replace(/(\d+(?:\.\d+)?)%/g, '$1 percent');
  s = s.replace(/\b(\d{1,3})\s?[-–:]\s?(\d{1,3})\b(?!\s*(?:seconds|minutes|percent))/g, sport === 'nfl' ? '$1 to $2' : '$1 $2');
  s = s.replace(/(\d+)'/g, '$1 minutes');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
