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
      include: [
        'src/app/api/**/*.{ts,tsx}',
        'src/components/**/*.{ts,tsx}',
        'src/lib/**/*.{ts,tsx}',
        'src/contexts/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/lib/bpmn/**',
        'src/lib/workflow.ts',
        'src/lib/actions.ts',
        'src/lib/redisConsumer.ts',
        'src/components/BpmnViewer.tsx',
        'src/components/BpmnViewerLoader.tsx',
        'src/components/ThemeRegistry.tsx',
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
