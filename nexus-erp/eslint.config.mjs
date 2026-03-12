import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import vitestPlugin from 'eslint-plugin-vitest'
import nextPlugin from '@next/eslint-plugin-next'
import prettierConfig from 'eslint-config-prettier'
import {
  TEST_PATTERNS,
  IGNORE_PATTERNS,
  SHARED_RULES,
} from '../eslint.config.base.mjs'

export default tseslint.config(
  { ignores: IGNORE_PATTERNS },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  // Next.js core web vitals rules (React + Next.js specific)
  nextPlugin.flatConfig.coreWebVitals,

  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      ...SHARED_RULES,
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'import/order': [
        'warn',
        { groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'] },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
  },

  {
    files: TEST_PATTERNS,
    plugins: { vitest: vitestPlugin },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettierConfig,
)
