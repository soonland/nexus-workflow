import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import vitestPlugin from 'eslint-plugin-vitest'
import prettierConfig from 'eslint-config-prettier'
import {
  TEST_PATTERNS,
  IGNORE_PATTERNS,
  SHARED_RULES,
  CORE_IMPORT_RESTRICTIONS,
} from '../eslint.config.base.mjs'

export default tseslint.config(
  { ignores: IGNORE_PATTERNS },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ['**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      ...SHARED_RULES,
      'no-restricted-imports': ['error', { patterns: CORE_IMPORT_RESTRICTIONS }],
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
      // Non-null assertions, any, and empty interfaces are acceptable in test/setup code
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  prettierConfig,
)
