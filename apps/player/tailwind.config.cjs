/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@huddle/shared/tailwind-preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'flash-up': { '0%': { backgroundColor: 'rgba(56,189,248,0.35)' }, '100%': { backgroundColor: 'transparent' } },
        'flash-down': { '0%': { backgroundColor: 'rgba(255,159,28,0.35)' }, '100%': { backgroundColor: 'transparent' } },
      },
      animation: {
        'flash-up': 'flash-up 0.9s ease-out',
        'flash-down': 'flash-down 0.9s ease-out',
      },
    },
  },
};
