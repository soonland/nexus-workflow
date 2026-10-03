import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig } from 'vitest/config'

// The console is served by nexus-workflow-app under /console, on the same origin as the API,
// so it calls the API with relative URLs. In development Vite proxies those to the API.
const API_URL = process.env['WORKFLOW_API_URL'] ?? 'http://localhost:3000'

// The API refuses state-changing calls whose Origin is not its own (a CSRF check). The browser
// sends the dev server's origin, so the proxy presents the request as coming from the API's.
const apiProxy: ProxyOptions = {
  target: API_URL,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on('proxyReq', (request) => {
      if (request.getHeader('origin')) request.setHeader('origin', API_URL)
    })
  },
}

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: {
    port: 3002,
    proxy: Object.fromEntries(
      ['/tenants', '/users', '/auth', '/definitions', '/instances', '/tasks', '/webhooks'].map((path) => [path, apiProxy]),
    ),
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
