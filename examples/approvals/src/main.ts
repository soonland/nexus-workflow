/* eslint-disable no-console -- the terminal is where this server reports */
import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createWebApp } from './web.js'
import { createApprovals } from './workflow.js'

const baseUrl = process.env['WORKFLOW_API_URL'] ?? 'http://localhost:3000'
const apiKey = process.env['WORKFLOW_API_KEY']
const port = Number(process.env['PORT'] ?? 3003)

if (!apiKey) {
  console.error('WORKFLOW_API_KEY is not set. See examples/approvals/README.md.')
  process.exit(1)
}

const approvals = createApprovals({ baseUrl, apiKey })
const xml = await readFile(new URL('../process/approval-request.bpmn', import.meta.url), 'utf8')

try {
  await approvals.deployIfMissing(xml)
} catch (error) {
  console.error(`Could not reach the workflow API at ${baseUrl}. Is it running?`, error)
  process.exit(1)
}

// Local only: there is no login, and whoever reaches this server acts with the API key
serve({ fetch: createWebApp(approvals).fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Approval requests: http://localhost:${port}`)
})
