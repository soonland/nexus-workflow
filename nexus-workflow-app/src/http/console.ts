import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Env, Hono, MiddlewareHandler } from 'hono'

// The console holds the operator's credentials, so it is served with a strict policy: scripts and
// connections only from this origin (the API it talks to), no framing, no plugins. `style-src`
// keeps 'unsafe-inline' because MUI/emotion injects styles at runtime; scripts stay strict.
const CONSOLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/**
 * Serves the built operator console (nexus-workflow-console) under `/console`.
 *
 * The console is a static single-page app that calls this API from the browser with the admin
 * key the operator types in, so the page itself is public and must be registered *before* the
 * auth middleware. Returns false, mounting nothing, if the console has not been built.
 */
export function mountConsole<E extends Env>(app: Hono<E>, consoleDir: string): boolean {
  if (!existsSync(join(consoleDir, 'index.html'))) return false

  // serveStatic resolves its root against the working directory
  const root = relative(process.cwd(), consoleDir) || '.'

  // Hardening headers on everything under /console (and only there: the API has its own concerns)
  const hardenConsole: MiddlewareHandler = async (c, next) => {
    await next()
    c.header('Content-Security-Policy', CONSOLE_CSP)
    c.header('X-Frame-Options', 'DENY')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
  }
  app.use('/console', hardenConsole)
  app.use('/console/*', hardenConsole)

  app.get('/console', (c) => c.redirect('/console/'))
  app.use('/console/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/console/, '') }))
  // Anything else under /console is a client-side route: hand it the app shell
  app.get('/console/*', serveStatic({ root, path: 'index.html' }))
  return true
}
