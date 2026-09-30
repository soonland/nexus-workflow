import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { workflowFetch, deployDefinition } from '@/lib/workflow'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'd', version: 1 })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('workflowFetch', () => {
  it('sends WORKFLOW_API_KEY as a Bearer token', async () => {
    vi.stubEnv('WORKFLOW_API_KEY', 'secret-key')

    await workflowFetch('/definitions/x')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/definitions/x')
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-key' })
  })

  it('omits the Authorization header when no key is configured', async () => {
    vi.stubEnv('WORKFLOW_API_KEY', '')

    await workflowFetch('/definitions/x')

    expect(fetchMock.mock.calls[0][1].headers).toEqual({})
  })

  it('keeps caller-supplied headers and options', async () => {
    vi.stubEnv('WORKFLOW_API_KEY', 'secret-key')

    await workflowFetch('/instances', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    })

    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    })
  })
})

describe('workflow API client', () => {
  it('authenticates definition deployments', async () => {
    vi.stubEnv('WORKFLOW_API_KEY', 'secret-key')

    await deployDefinition('<xml/>')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/definitions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key' })
  })
})
