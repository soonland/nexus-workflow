import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { dnsResolver, resolveWebhookTarget, type HostResolver, type WebhookUrlPolicy } from './urlPolicy.js'

export interface WebhookRequest {
  method: string
  headers: Record<string, string>
  body: string
}

/** What delivery needs to know about an answer: the response body is never read. */
export interface WebhookResponse {
  ok: boolean
  status: number
}

export type WebhookFetch = (url: string, init: WebhookRequest) => Promise<WebhookResponse>

export interface SafeFetchOptions {
  policy: WebhookUrlPolicy
  resolver?: HostResolver
  /** Total time allowed for connecting and receiving the response status. Default: 10 s. */
  timeoutMs?: number
}

function send(
  url: URL,
  address: string,
  init: WebhookRequest,
  timeoutMs: number,
): Promise<WebhookResponse & { connected: boolean }> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:'
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    let connected = false
    const req = (secure ? httpsRequest : httpRequest)(
      {
        // Connect to the address that was validated, not to whatever the name resolves to now.
        host: address,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: { ...init.headers, Host: url.host, 'Content-Length': Buffer.byteLength(init.body) },
        ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0
        // Redirects are not followed: a 3xx is a failed delivery, and the body is not read.
        res.destroy()
        resolve({ ok: status >= 200 && status < 300, status, connected: true })
      },
    )
    req.on('socket', (socket) => {
      socket.once(secure ? 'secureConnect' : 'connect', () => {
        connected = true
      })
    })
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)))
    req.on('error', (err) => reject(Object.assign(err, { connected })))
    req.end(init.body)
  })
}

/**
 * A delivery function for webhooks that only connects to targets the policy allows. The name is
 * resolved once, every answer is checked, and the connection goes to that checked address, so a
 * name that changes its answer between the check and the connection cannot redirect the request.
 */
export function createSafeFetch(options: SafeFetchOptions): WebhookFetch {
  const resolver = options.resolver ?? dnsResolver
  const timeoutMs = options.timeoutMs ?? 10_000
  return async (rawUrl, init) => {
    const { url, addresses } = await resolveWebhookTarget(rawUrl, options.policy, resolver)
    let lastError: unknown
    for (const address of addresses) {
      try {
        const { ok, status } = await send(url, address, init, timeoutMs)
        return { ok, status }
      } catch (err) {
        lastError = err
        // Only a failure to connect is worth trying another address for.
        if ((err as { connected?: boolean }).connected) break
      }
    }
    throw lastError
  }
}
