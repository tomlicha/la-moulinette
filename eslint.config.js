// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Règles recommandées, plus celles qui comptent ici : l'application vit de promesses (Bluetooth, envois au
 * trainer, export) ; une promesse oubliée, c'est une erreur qui disparaît sans laisser de trace.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.claude/**', 'public/**', '.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Espaces insécables voulus dans les textes (typographie française : « 18 km », « 12 % »).
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
);
