import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    isolate: true,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/db/client.ts',
        'src/lib/bpmn/**',
        'src/lib/workflow.ts',
        'src/i18n/**',
      ],
      reporter: ['text', 'lcov', 'html', 'json-summary', 'json'],
      thresholds: {
        statements: 80,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
