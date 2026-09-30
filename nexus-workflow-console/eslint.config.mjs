import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { importX } from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import vitestPlugin from '@vitest/eslint-plugin'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'
import { TEST_PATTERNS, IGNORE_PATTERNS, SHARED_RULES } from '../eslint.config.base.mjs'

export default tseslint.config(
  { ignores: IGNORE_PATTERNS },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'import-x': importX, 'react-hooks': reactHooksPlugin },
    rules: {
      ...SHARED_RULES,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/order': [
        'warn',
        { groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'] },
      ],
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
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
