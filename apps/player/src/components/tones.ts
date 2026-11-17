import { toneFor as uiToneFor, type Tone } from '@huddle/ui';

/**
 * Tailwind classes per outcome tone (DESIGN.md sections 2 and 9): 1st YES blue, last NO tangerine,
 * middle ones sun / lilac hatched. `text` is the -600 shade for coloured text on light surfaces,
 * `deep` the resting tint, `rule` the solid swatch, `solid` + `ink` the selected game tile,
 * `shadow` the coloured lift under a selected tile, `line` the sparkline colours.
 */
const CLASSES: Record<Tone, { text: string; deep: string; rule: string; solid: string; ink: string; shadow: string; line: { stroke: string; fill: string } }> = {
  yes: {
    text: 'text-yes-600',
    deep: 'bg-yes-50',
    rule: 'hd-tone-yes',
    solid: 'bg-yes',
    ink: 'text-yes-on',
    shadow: 'shadow-yes',
    line: { stroke: '#1468FF', fill: 'rgba(20,104,255,0.14)' },
  },
  no: {
    text: 'text-no-600',
    deep: 'bg-no-50',
    rule: 'hd-tone-no',
    solid: 'bg-no',
    ink: 'text-no-on',
    shadow: 'shadow-no',
    line: { stroke: '#FF6B00', fill: 'rgba(255,107,0,0.14)' },
  },
  other: {
    text: 'text-sun-600',
    deep: 'bg-sun-50',
    rule: 'hd-tone-other',
    solid: 'bg-sun',
    ink: 'text-sun-on',
    shadow: 'shadow-gold',
    line: { stroke: '#8A5F00', fill: 'rgba(255,200,61,0.2)' },
  },
  'other-alt': {
    text: 'text-lilac-600',
    deep: 'bg-lilac-50',
    rule: 'hd-tone-other-alt',
    solid: 'bg-lilac',
    ink: 'text-lilac-on',
    shadow: 'shadow-lift',
    line: { stroke: '#5B46C7', fill: 'rgba(185,168,255,0.24)' },
  },
};

export type ToneClasses = (typeof CLASSES)[Tone] & { tone: Tone };

/** Classes for outcome `index` of `count` (binary markets are always blue / orange). */
export function tone(index: number, count: number): ToneClasses {
  const t = uiToneFor(Math.max(0, index), Math.max(2, count));
  return { ...CLASSES[t], tone: t };
}
