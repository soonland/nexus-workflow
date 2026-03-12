import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      DATABASE_URL: 'postgres://nexus:nexus@localhost:5433/nexus_workflow_test',
    },
  },
})
