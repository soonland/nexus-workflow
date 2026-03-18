import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      DATABASE_URL: 'postgres://nexus:nexus@localhost:5433/nexus_workflow',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/config.ts',       // env var reads — not unit-testable
        'src/main.ts',         // application entry point — not unit-testable
        'src/db/reset-cli.ts', // CLI utility — not unit-testable
        'src/db/migrate.ts',   // migration runner — not unit-testable
      ],
      reporter: ['text', 'lcov', 'html', 'json-summary', 'json'],
      thresholds: {
        statements: 85,
        branches: 80,
      },
    },
  },
})
