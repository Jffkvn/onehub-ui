import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  // Ignore contract folder and build output
  {
    ignores: [
      'src/_contract/**/*',
      'dist/**/*',
      'coverage/**/*',
      'playwright-report/**/*',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce no unused variables
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Allow explicit any only as an escape hatch in test utilities
      '@typescript-eslint/no-explicit-any': 'warn',
      // Disallow floating promises (important for Supabase calls)
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // Relax type-checked rules for config files
  {
    files: ['*.config.ts', '*.config.js', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
