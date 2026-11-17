/**
 * Huddle design tokens: "Kickoff" (see DESIGN.md at the repo root).
 * Both UIs use this preset so the box and the phone read as one product.
 *
 *   // tailwind.config.cjs
 *   module.exports = {
 *     presets: [require('@huddle/shared/tailwind-preset.cjs')],
 *     content: ['./index.html', './src/**\/*.{ts,tsx}', '../../packages/ui/src/**\/*.{ts,tsx}'],
 *   };
 *
 * Kickoff is light and vibrant: a cool lilac-white canvas, white cards that float on soft tinted
 * shadows, deep indigo ink, one electric violet accent (zap), and the D14 colour-blind-safe pair
 * for outcomes (YES electric blue, NO tangerine; never red vs green, always with a label or icon).
 *
 * Colour roles
 *   canvas / card / well / control / rule   surfaces, light to darker (canvas is the page)
 *   ink (DEFAULT, 2, muted, faint)          text, strongest to disabled
 *   zap                                     THE accent: primary action, focus, "now", the room
 *   yes / no                                outcomes + up/down. `yes-600` / `no-600` are the
 *                                           text-safe shades on light surfaces
 *   sun, lilac                              3rd+ outcomes, always hatched (hd-tone-other*)
 *   hot                                     LIVE dot and the last-five-seconds urgency only
 *   gold                                    money moving: coins, the pot, the winner's crown
 *
 * Round-one ("Floodlight") names are kept so code that has not been re-skinned yet still builds
 * and still looks like round one: night-*, chalk, flood, yes/no deep|ink|bright|dim, other-*,
 * pitch, volt, up, down, gemini, model. DESIGN.md has the one-to-one mapping to the new names.
 */

// ---------------------------------------------------------------- Kickoff (new)
const canvas = { DEFAULT: '#F4F3FA', deep: '#EAE8F4' }; // page; deep = page edge / inset fields
const card = { DEFAULT: '#FFFFFF', tint: '#FBFAFF' }; // raised surfaces
const well = '#ECEAF5'; // wells inside cards
const control = { DEFAULT: '#E4E1F1', hover: '#D9D5EB' }; // resting secondary controls, inputs
const rule = { DEFAULT: '#DCD9EA', strong: '#C4C0D8' }; // hairlines; strong = disabled fills
const ink = { DEFAULT: '#14123A', 2: '#4A4770', muted: '#6B6890', faint: '#8A86AA' };
const zap = {
  DEFAULT: '#6C2BFF',
  bright: '#8A55FF',
  deep: '#5214E6',
  50: '#F2ECFF',
  100: '#E4D8FF',
  200: '#CDB8FF',
  ink: '#FFFFFF',
};

// ---------------------------------------------------------------- Floodlight (legacy, dark)
const night = {
  950: '#08090B',
  900: '#0E1013',
  850: '#13161A',
  800: '#181C21',
  700: '#232830',
  600: '#343B45',
  500: '#535C68',
  400: '#87909B',
  300: '#AEB5BD',
  200: '#CED3D8',
  100: '#E6E8EA',
};
const chalk = { DEFAULT: '#F4F2EC', dim: '#D9D6CD' };
const flood = { DEFAULT: '#FFE27A', bright: '#FFF0B8', dim: '#C9A93F', ink: '#1A1505', glow: 'rgba(255,226,122,0.35)' };

// ---------------------------------------------------------------- outcomes (shared names)
// DEFAULT is the vibrant fill (Kickoff); 50/100/200 light tints and 600/700 text shades are new;
// bright/dim/deep/ink keep their round-one (dark theme) values for code not yet re-skinned.
const yes = {
  DEFAULT: '#1468FF', // fill: white text on it (4.7:1)
  50: '#EAF1FF',
  100: '#D5E3FF',
  200: '#A9C6FF',
  600: '#0B57E6', // text on light surfaces (5.6:1 on white)
  700: '#0841B0',
  on: '#FFFFFF',
  bright: '#9AD7FF',
  dim: '#1D5C86',
  deep: '#0C2638',
  ink: '#03131F',
};
const no = {
  DEFAULT: '#FF6B00', // fill: ink text on it (6.3:1)
  50: '#FFF1E6',
  100: '#FFDFC7',
  200: '#FFBE8F',
  600: '#C24A00', // text on light surfaces (4.9:1 on white)
  700: '#943800',
  on: '#14123A',
  bright: '#FFB878',
  dim: '#8A4612',
  deep: '#2E1707',
  ink: '#1F0D00',
};
const sun = { DEFAULT: '#FFC83D', 50: '#FFF7DF', 600: '#8A5F00', on: '#14123A' };
const lilac = { DEFAULT: '#B9A8FF', 50: '#F3F0FF', 600: '#5B46C7', on: '#14123A' };
const other = { DEFAULT: '#C8C1B2', dim: '#6E695F', deep: '#1E1C19', ink: '#14120E' }; // legacy
const hot = { DEFAULT: '#FF2E63', 50: '#FFE8EE', 600: '#D1003A', on: '#14123A' };
const gold = { DEFAULT: '#FFB020', 50: '#FFF5DE', 100: '#FFE6AD', 600: '#8F5A00', on: '#14123A' };

module.exports = {
  theme: {
    extend: {
      colors: {
        canvas,
        card,
        well,
        control,
        rule,
        ink,
        zap,
        yes,
        no,
        sun,
        lilac,
        hot,
        gold,

        // Floodlight (round one), still used by screens not yet re-skinned.
        night,
        chalk,
        flood,
        other,
        live: '#FF4D5E',
        pitch: {
          950: night[950],
          900: night[900],
          800: night[800],
          700: night[700],
          600: night[600],
          400: night[400],
          200: night[200],
          50: chalk.DEFAULT,
        },
        volt: { DEFAULT: flood.DEFAULT, dim: flood.dim, ink: flood.ink },
        up: { DEFAULT: yes.DEFAULT, dim: yes.dim, ink: yes.ink },
        down: { DEFAULT: no.DEFAULT, dim: no.dim, ink: no.ink },
        gemini: night[200],
        model: night[300],
      },
      fontFamily: {
        // Words with personality: questions, headlines, names on the box, the wordmark.
        // Bricolage Grotesque (wght 200-800, wdth 75-100, optical size 12-96 applied automatically).
        head: ['"Bricolage Grotesque Variable"', '"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        // Numbers: odds, prices, money, countdowns, scores. Archivo (wght 100-900, wdth 62-125), tnum.
        num: ['"Archivo Variable"', '"Archivo"', '"Arial Narrow"', 'system-ui', 'sans-serif'],
        // Legacy name for the number face (round one used it for questions too).
        display: ['"Archivo Variable"', '"Archivo"', '"Arial Narrow"', 'system-ui', 'sans-serif'],
        // Everything people read: hyperlegible at 3 m.
        sans: ['"Atkinson Hyperlegible Next Variable"', '"Atkinson Hyperlegible Next"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // One scale for both apps (rem). The phone has 1rem = 16px; the box scales rem with the
        // viewport (1rem = 16px at 1024x600, about 28.8px at 1920x1080). [size, line-height]
        cap: ['0.8125rem', { lineHeight: '1.25' }], // 13: fine print only
        small: ['0.9375rem', { lineHeight: '1.35' }], // 15
        body: ['1.0625rem', { lineHeight: '1.45' }], // 17
        lead: ['1.25rem', { lineHeight: '1.35' }], // 20
        title: ['1.625rem', { lineHeight: '1.12', letterSpacing: '-0.01em' }], // 26
        head: ['2.25rem', { lineHeight: '1.02', letterSpacing: '-0.02em' }], // 36
        display: ['3.5rem', { lineHeight: '0.92', letterSpacing: '-0.025em' }], // 56
        hero: ['5.5rem', { lineHeight: '0.86', letterSpacing: '-0.03em' }], // 88
        giant: ['8.5rem', { lineHeight: '0.82', letterSpacing: '-0.04em' }], // 136
      },
      borderRadius: {
        chip: '0.5rem', // 8: bars, chips, small buttons
        tile: '0.875rem', // 14: controls, rows
        panel: '1.375rem', // 22: cards, sheets, the stage
        blob: '2rem', // 32: hero panels
        card: '1.375rem', // legacy
      },
      boxShadow: {
        // Kickoff: light comes from above; shadows carry the indigo of the ink, or the colour of the
        // thing that floats (zap, yes, no, gold) when it is the one thing to press.
        lift: '0 1px 0 rgba(20,18,58,0.04), 0 10px 28px -14px rgba(52,36,140,0.28)',
        pop: '0 2px 0 rgba(20,18,58,0.04), 0 24px 56px -20px rgba(52,36,140,0.42)',
        zap: '0 10px 28px -10px rgba(108,43,255,0.65), inset 0 1px 0 rgba(255,255,255,0.28)',
        yes: '0 10px 28px -12px rgba(20,104,255,0.6)',
        no: '0 10px 28px -12px rgba(255,107,0,0.6)',
        gold: '0 10px 28px -10px rgba(255,176,32,0.7)',
        press: 'inset 0 -3px 0 rgba(20,18,58,0.18)',
        // Floodlight (legacy)
        float: '0 18px 48px -16px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
        flood: '0 0 0 1px rgba(255,226,122,0.45), 0 10px 36px -10px rgba(255,226,122,0.45)',
        glow: '0 0 0 1px rgba(255,226,122,0.45), 0 10px 36px -10px rgba(255,226,122,0.45)',
        card: '0 0 0 1px rgba(255,255,255,0.05) inset',
      },
      backgroundImage: {
        // The one brand gradient: violet -> magenta -> pink. Big moments only (join panel, the
        // moment-market band, the primary action on home, a win).
        prime: 'linear-gradient(120deg, #6C2BFF 0%, #B22BFF 52%, #FF2E93 100%)',
        'prime-soft': 'linear-gradient(120deg, #F2ECFF 0%, #FBEAFF 52%, #FFE9F3 100%)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        in: 'cubic-bezier(0.55, 0, 1, 0.45)',
        snap: 'cubic-bezier(0.85, 0, 0.15, 1)',
        swing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        instant: '90ms',
        quick: '160ms',
        base: '240ms',
        slow: '420ms',
        linger: '700ms',
      },
      zIndex: {
        stage: '10',
        rail: '20',
        reveal: '30',
        panel: '40',
        talk: '50',
        led: '60',
        toast: '70',
        gate: '80',
      },
      keyframes: {
        // Legacy keyframes kept for code written against the old preset.
        'pulse-ring': { '0%': { transform: 'scale(0.9)', opacity: '0.9' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        'tick-up': { '0%': { color: yes.DEFAULT, transform: 'translateY(4px)' }, '100%': { transform: 'translateY(0)' } },
        'tick-down': { '0%': { color: no.DEFAULT, transform: 'translateY(-4px)' }, '100%': { transform: 'translateY(0)' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.4s cubic-bezier(0.2,0.6,0.4,1) infinite',
        'tick-up': 'tick-up 0.5s ease-out',
        'tick-down': 'tick-down 0.5s ease-out',
      },
    },
  },
  plugins: [
    // font-stretch utilities for the variable faces.
    function ({ addUtilities }) {
      addUtilities({
        '.stretch-tight': { 'font-stretch': '62%' },
        '.stretch-condensed': { 'font-stretch': '75%' },
        '.stretch-semi': { 'font-stretch': '87.5%' },
        '.stretch-normal': { 'font-stretch': '100%' },
        '.stretch-wide': { 'font-stretch': '112.5%' },
        '.stretch-extra': { 'font-stretch': '125%' },
        '.tnum': { 'font-variant-numeric': 'tabular-nums', 'font-feature-settings': '"tnum" 1' },
      });
    },
  ],
};
