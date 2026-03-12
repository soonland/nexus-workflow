/**
 * Shared ESLint base data for the nexus-workflow monorepo.
 *
 * This file exports plain objects only (no plugin imports) so it can be
 * safely imported by any project's eslint.config.mjs regardless of where
 * each project's node_modules lives.
 */

/** Glob patterns that identify test files and test infrastructure across all projects. */
export const TEST_PATTERNS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/tests/setup.ts',
  '**/tests/setup.tsx',
]

/** Paths to ignore in every project. */
export const IGNORE_PATTERNS = [
  '**/dist/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.d.ts',
]

/**
 * Shared rule overrides applied on top of recommended presets.
 * Keep this list short — prefer preset defaults where possible.
 */
export const SHARED_RULES = {
  'no-console': 'warn',
  // Allow _-prefixed names to be unused (conventional "intentionally unused" marker)
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
}

/**
 * no-restricted-imports patterns for nexus-workflow-core.
 * Core must never import from app or erp.
 */
export const CORE_IMPORT_RESTRICTIONS = [
  {
    group: ['../nexus-workflow-app', '../nexus-workflow-app/**'],
    message: 'nexus-workflow-core must not import from nexus-workflow-app.',
  },
  {
    group: ['../nexus-erp', '../nexus-erp/**'],
    message: 'nexus-workflow-core must not import from nexus-erp.',
  },
]

/**
 * no-restricted-imports patterns for nexus-workflow-app.
 * App must never import from erp.
 */
export const APP_IMPORT_RESTRICTIONS = [
  {
    group: ['../nexus-erp', '../nexus-erp/**'],
    message: 'nexus-workflow-app must not import from nexus-erp.',
  },
]
