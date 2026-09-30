import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Env, Hono } from 'hono'

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

  app.get('/console', (c) => c.redirect('/console/'))
  app.use('/console/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/console/, '') }))
  // Anything else under /console is a client-side route: hand it the app shell
  app.get('/console/*', serveStatic({ root, path: 'index.html' }))
  return true
}
