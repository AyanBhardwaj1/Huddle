/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@huddle/shared/tailwind-preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};
