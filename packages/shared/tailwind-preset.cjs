/**
 * Shared Huddle design tokens (PRD section 13: dark, sporty, color-blind-safe).
 * Both UIs use this preset so the box and the phone look like one product.
 *
 *   // tailwind.config.cjs
 *   module.exports = { presets: [require('@huddle/shared/tailwind-preset.cjs')], content: [...] }
 *
 * Win/loss never rely on red vs green: YES / win = "up" (cyan-blue), NO / loss = "down" (orange),
 * and every state also carries a label or icon.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        pitch: {
          950: '#07090D', // page background
          900: '#0C1017', // surfaces
          800: '#141A24', // raised cards
          700: '#1E2633', // borders, wells
          600: '#2C3748',
          400: '#7C8AA0', // muted text
          200: '#C9D2E0', // secondary text
          50: '#F4F7FB', // primary text
        },
        volt: { DEFAULT: '#D4FF3A', dim: '#A9D11F', ink: '#141A05' }, // brand accent, primary actions
        up: { DEFAULT: '#38BDF8', dim: '#0B6FA4', ink: '#04202F' }, // YES, win, price up
        down: { DEFAULT: '#FF9F1C', dim: '#B36200', ink: '#2E1A00' }, // NO, loss, price down
        gemini: '#8B7CFF', // "the Pros" column
        model: '#F472B6', // the model's number
        live: '#FF4D5E', // live dot, lock countdown urgency
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Impact', 'system-ui', 'sans-serif'], // scores, odds, headlines
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { card: '1.25rem' },
      boxShadow: {
        glow: '0 0 0 1px rgba(212,255,58,0.35), 0 8px 40px -8px rgba(212,255,58,0.35)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'pulse-ring': { '0%': { transform: 'scale(0.9)', opacity: '0.9' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        'tick-up': { '0%': { color: '#38BDF8', transform: 'translateY(4px)' }, '100%': { transform: 'translateY(0)' } },
        'tick-down': { '0%': { color: '#FF9F1C', transform: 'translateY(-4px)' }, '100%': { transform: 'translateY(0)' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.4s cubic-bezier(0.2,0.6,0.4,1) infinite',
        'tick-up': 'tick-up 0.5s ease-out',
        'tick-down': 'tick-down 0.5s ease-out',
      },
    },
  },
};
