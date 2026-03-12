import { defineConfig } from 'vitest/config'
import path from 'path'

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
        'src/lib/theme.ts',
        'src/contexts/ThemeContext.tsx',
        'src/app/api/users/[id]/preferences/route.ts',
      ],
      reporter: ['text', 'lcov', 'html', 'json-summary', 'json'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
