import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly' },
    },
    rules: { 'no-unused-vars': 'off', 'no-undef': 'error' },
  },
];
