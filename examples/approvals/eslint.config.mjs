import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { IGNORE_PATTERNS, SHARED_RULES } from '../../eslint.config.base.mjs'

export default tseslint.config(
  { ignores: IGNORE_PATTERNS },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,
  { files: ['**/*.ts'], rules: SHARED_RULES },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)
