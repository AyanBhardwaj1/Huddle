/**
 * Huddle design tokens: "Floodlight" (see DESIGN.md at the repo root).
 * Both UIs use this preset so the box and the phone read as one product.
 *
 *   // tailwind.config.cjs
 *   module.exports = {
 *     presets: [require('@huddle/shared/tailwind-preset.cjs')],
 *     content: ['./index.html', './src/**\/*.{ts,tsx}', '../../packages/ui/src/**\/*.{ts,tsx}'],
 *   };
 *
 * Colour roles (one accent, D14 pair, everything else neutral):
 *   night  the room at night: surfaces and text, one cool-neutral family
 *   chalk  primary text and the brightest surfaces
 *   flood  THE accent (floodlight): primary actions, focus, "now", the room's own number
 *   yes    YES / up / win  (sky blue)   always paired with a label or an up/check icon
 *   no     NO / down / loss (orange)    always paired with a label or a down/cross icon
 *   other  third and later outcomes on categorical markets (bone), drawn hatched
 *   live   the broadcast LIVE dot only (always next to the word "Live")
 * Win/loss never relies on red vs green. Model and Gemini are neutrals with labels, not extra hues.
 *
 * Legacy names (pitch, volt, up, down, gemini, model) are kept as aliases onto the new palette so
 * code written against the old preset still builds. New code uses the new names.
 */

const night = {
  950: '#08090B', // page
  900: '#0E1013', // raised field (panels, sheets)
  850: '#13161A', // wells
  800: '#181C21', // inputs, resting controls
  700: '#232830', // rules, hairlines
  600: '#343B45', // strong rules, disabled fill
  500: '#535C68', // disabled text
  400: '#87909B', // muted text (6.3:1 on 950)
  300: '#AEB5BD',
  200: '#CED3D8', // secondary text
  100: '#E6E8EA',
};
const chalk = { DEFAULT: '#F4F2EC', dim: '#D9D6CD' };
const flood = { DEFAULT: '#FFE27A', bright: '#FFF0B8', dim: '#C9A93F', ink: '#1A1505', glow: 'rgba(255,226,122,0.35)' };
const yes = { DEFAULT: '#4CB8FF', bright: '#9AD7FF', dim: '#1D5C86', deep: '#0C2638', ink: '#03131F' };
const no = { DEFAULT: '#FF8A2B', bright: '#FFB878', dim: '#8A4612', deep: '#2E1707', ink: '#1F0D00' };
const other = { DEFAULT: '#C8C1B2', dim: '#6E695F', deep: '#1E1C19', ink: '#14120E' };

module.exports = {
  theme: {
    extend: {
      colors: {
        night,
        chalk,
        flood,
        yes,
        no,
        other,
        live: '#FF4D5E',

        // Legacy aliases (old preset names), mapped onto Floodlight.
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
        // Numbers, scores, odds, countdowns, questions. Variable width: use font-stretch
        // (`stretch-condensed` etc. below) rather than a second family.
        display: ['"Archivo Variable"', '"Archivo"', '"Arial Narrow"', 'system-ui', 'sans-serif'],
        // Everything people read: hyperlegible in a dim room at 3 m.
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
        head: ['2.25rem', { lineHeight: '1.02', letterSpacing: '-0.015em' }], // 36
        display: ['3.5rem', { lineHeight: '0.92', letterSpacing: '-0.02em' }], // 56
        hero: ['5.5rem', { lineHeight: '0.86', letterSpacing: '-0.03em' }], // 88
        giant: ['8.5rem', { lineHeight: '0.82', letterSpacing: '-0.04em' }], // 136
      },
      borderRadius: {
        chip: '0.375rem',
        tile: '0.75rem',
        panel: '1.125rem',
        card: '1.125rem', // legacy
      },
      boxShadow: {
        // Elevation is mostly surface tone; shadows only for things that float (sheets, toasts).
        float: '0 18px 48px -16px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
        flood: '0 0 0 1px rgba(255,226,122,0.45), 0 10px 36px -10px rgba(255,226,122,0.45)',
        glow: '0 0 0 1px rgba(255,226,122,0.45), 0 10px 36px -10px rgba(255,226,122,0.45)', // legacy
        card: '0 0 0 1px rgba(255,255,255,0.05) inset', // legacy
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        in: 'cubic-bezier(0.55, 0, 1, 0.45)',
        snap: 'cubic-bezier(0.85, 0, 0.15, 1)',
        swing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
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
    // font-stretch utilities for the variable display face.
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
