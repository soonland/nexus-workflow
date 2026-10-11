import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSafeFetch } from './safeFetch.js'
import { WebhookUrlError } from './urlPolicy.js'

const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' }
const loopbackAllowed = { allowHttp: true, allowedHosts: ['127.0.0.0/8'] }

describe('createSafeFetch', () => {
  let server: Server
  let port: number
  let seen: { host?: string; url?: string; body: string }[]
  let respond: (res: import('node:http').ServerResponse) => void

  beforeEach(async () => {
    seen = []
    respond = (res) => res.writeHead(200).end('ok')
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (d: Buffer) => (body += d.toString()))
      req.on('end', () => {
        seen.push({ host: req.headers.host, url: req.url, body })
        respond(res)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterEach(() => new Promise<void>((r) => server.close(() => r())))

  it('delivers to an allowed target', async () => {
    const send = createSafeFetch({ policy: loopbackAllowed })
    const res = await send(`http://127.0.0.1:${port}/hook?x=1`, init)
    expect(res).toEqual({ ok: true, status: 200 })
    expect(seen[0]).toMatchObject({ url: '/hook?x=1', body: '{"a":1}', host: `127.0.0.1:${port}` })
  })

  it('connects to the checked address and keeps the original Host header', async () => {
    const send = createSafeFetch({ policy: loopbackAllowed, resolver: async () => ['127.0.0.1'] })
    await send(`http://hooks.example.com:${port}/x`, init)
    expect(seen[0]?.host).toBe(`hooks.example.com:${port}`)
  })

  it('refuses a loopback target by default', async () => {
    const send = createSafeFetch({ policy: { allowHttp: true, allowedHosts: [] } })
    await expect(send(`http://127.0.0.1:${port}/hook`, init)).rejects.toBeInstanceOf(WebhookUrlError)
    expect(seen).toHaveLength(0)
  })

  it('refuses a name that resolves to an internal address at delivery time', async () => {
    let answer = '93.184.216.34'
    const send = createSafeFetch({
      policy: { allowHttp: true, allowedHosts: [] },
      resolver: async () => [answer],
    })
    answer = '127.0.0.1'
    await expect(send(`http://rebind.example.com:${port}/x`, init)).rejects.toBeInstanceOf(WebhookUrlError)
    expect(seen).toHaveLength(0)
  })

  it('does not follow redirects', async () => {
    respond = (res) => res.writeHead(302, { Location: `http://127.0.0.1:${port}/other` }).end()
    const send = createSafeFetch({ policy: loopbackAllowed })
    const res = await send(`http://127.0.0.1:${port}/hook`, init)
    expect(res).toEqual({ ok: false, status: 302 })
    expect(seen).toHaveLength(1)
  })

  it('reports a non-2xx status as a failed delivery', async () => {
    respond = (res) => res.writeHead(500).end()
    const send = createSafeFetch({ policy: loopbackAllowed })
    expect(await send(`http://127.0.0.1:${port}/hook`, init)).toEqual({ ok: false, status: 500 })
  })

  it('gives up when the target does not answer in time', async () => {
    respond = () => undefined
    const send = createSafeFetch({ policy: loopbackAllowed, timeoutMs: 100 })
    await expect(send(`http://127.0.0.1:${port}/hook`, init)).rejects.toThrow(/timed out/)
  })
})
