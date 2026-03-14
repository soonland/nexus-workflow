import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import vitestPlugin from '@vitest/eslint-plugin'
import nextPlugin from '@next/eslint-plugin-next'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
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
  // @next/eslint-plugin-next v16 moved from flatConfig.coreWebVitals to configs['core-web-vitals']
  nextPlugin.configs['core-web-vitals'],

  // React hooks rules — use only the classic two rules (rules-of-hooks + exhaustive-deps).
  // eslint-plugin-react-hooks@7 (bundled with eslint-config-next@16) added many React Compiler
  // lint rules (refs, set-state-in-effect, preserve-manual-memoization, etc.) to its
  // recommended-latest preset. Those rules require intentional React Compiler adoption and
  // would force large rewrites beyond the scope of this upgrade. We preserve the pre-upgrade
  // rule set by registering the plugin and enabling only the two classic rules explicitly.
  {
    plugins: { 'react-hooks': reactHooksPlugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

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
    files: ['**/*.tsx'],
    plugins: { react: reactPlugin },
    rules: {
      'react/function-component-definition': ['error', {
        namedComponents: 'arrow-function',
        unnamedComponents: 'arrow-function',
      }],
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
