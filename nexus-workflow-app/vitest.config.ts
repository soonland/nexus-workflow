import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      DATABASE_URL: 'postgres://nexus:nexus@localhost:5433/nexus_workflow_test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'lcov', 'html', 'json-summary', 'json'],
    },
  },
})
