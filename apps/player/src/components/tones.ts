import { toneFor as uiToneFor, type Tone } from '@huddle/ui';

/** Tailwind classes per outcome tone (DESIGN.md: 1st YES-blue, last NO-orange, middle hatched bone). */
const CLASSES: Record<Tone, { text: string; deep: string; rule: string; solid: string; ink: string }> = {
  yes: { text: 'text-yes', deep: 'bg-yes-deep', rule: 'hd-tone-yes', solid: 'bg-yes', ink: 'text-yes-ink' },
  no: { text: 'text-no', deep: 'bg-no-deep', rule: 'hd-tone-no', solid: 'bg-no', ink: 'text-no-ink' },
  other: { text: 'text-other', deep: 'bg-other-deep', rule: 'hd-tone-other', solid: 'hd-tone-other', ink: 'text-other-ink' },
  'other-alt': { text: 'text-other', deep: 'bg-other-deep', rule: 'hd-tone-other-alt', solid: 'hd-tone-other', ink: 'text-other-ink' },
};

export type ToneClasses = (typeof CLASSES)[Tone] & { tone: Tone };

/** Classes for outcome `index` of `count` (binary markets are always blue / orange). */
export function tone(index: number, count: number): ToneClasses {
  const t = uiToneFor(Math.max(0, index), Math.max(2, count));
  return { ...CLASSES[t], tone: t };
}
