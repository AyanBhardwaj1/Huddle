import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.claude/**', '.vercel-site/**', '.vercel/**', '**/dist/**', '**/node_modules/**', '**/target/**', '**/.turbo/**', 'ml/**', '**/*.config.{js,ts,cjs}', '**/dev-dist/**', '**/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
