import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.scenario.test.ts'],
    exclude: ['tests/fixtures/**'],
    isolate: true,
    pool: 'threads',
    slowTestThreshold: 100,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/interfaces/**',
        'src/index.ts',
      ],
      thresholds: {
        'src/engine/**': { lines: 90, branches: 85 },
        'src/gateways/**': { lines: 95, branches: 90 },
        'src/expression/**': { lines: 90, branches: 85 },
        lines: 80,
        branches: 75,
      },
      reporter: ['text', 'lcov', 'html', 'json-summary'],
    },
  },
})
