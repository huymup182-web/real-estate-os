// Cấu hình ESLint dùng chung cho toàn repo (flat config).
// backend/ và admin/ có thể bổ sung luật riêng khi được khởi tạo.
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/out/**',
      'mobile/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,

  // Luật chung
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Quy ước đặt tên cho TypeScript (xem docs/coding-standards.md)
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        { selector: 'import', format: null },
        { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
      ],
    },
  },

  // Script Node.js dạng CommonJS
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Tắt các luật định dạng trùng với Prettier
  eslintConfigPrettier,

  // Bật lại sau Prettier: luôn dùng ngoặc nhọn cho if/else/for/while (an toàn với Prettier khi dùng 'all')
  {
    rules: {
      curly: ['error', 'all'],
    },
  },
);
