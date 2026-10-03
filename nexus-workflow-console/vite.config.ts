import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The console is served by nexus-workflow-app under /console, on the same origin as the API,
// so it calls the API with relative URLs. In development Vite proxies those to the API.
const API_URL = process.env['WORKFLOW_API_URL'] ?? 'http://localhost:3000'

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      '/tenants': API_URL,
      '/users': API_URL,
      '/auth': API_URL,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
  },
})
