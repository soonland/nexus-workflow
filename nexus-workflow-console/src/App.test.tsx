import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionInfo } from './api/types'
import { App } from './App'
import { managerSession, operatorSession } from './test/fakeApi'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ACME = { id: 'acme', name: 'Acme Corp', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', activeKeyCount: 2 }

interface Server {
  /** Who the session cookie belongs to (null: nobody). */
  signedInAs: SessionInfo | null
  /** Password accepted for any known account. */
  accounts: Record<string, SessionInfo>
  adminKey: string
  invite: { token: string; email: string; name: string; session: SessionInfo } | null
}

/** A fake server: a session cookie is modelled by `server.signedInAs`. */
function makeServer(overrides: Partial<Server> = {}) {
  const server: Server = { signedInAs: null, accounts: {}, adminKey: 'right-key', invite: null, ...overrides }
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, string>) : {}
    const usesKey = headers['Authorization'] === `Bearer ${server.adminKey}`
    const wrongKey = headers['Authorization'] !== undefined && !usesKey
    const roles = server.signedInAs?.memberships.map((m) => m.role) ?? []

    if (url === '/auth/me') return server.signedInAs ? jsonResponse(server.signedInAs) : jsonResponse({ error: 'UNAUTHENTICATED' }, 401)
    if (url === '/auth/login') {
      const account = server.accounts[body['email'] ?? '']
      if (!account || body['password'] !== 'correct horse') {
        return jsonResponse({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, 401)
      }
      server.signedInAs = account
      return jsonResponse(account)
    }
    if (url === '/auth/logout') {
      server.signedInAs = null
      return jsonResponse({ success: true })
    }
    if (url === '/auth/invite-info' || url === '/auth/accept-invite') {
      const { invite } = server
      if (!invite || body['token'] !== invite.token) return jsonResponse({ error: 'INVALID_INVITE', message: 'invalid' }, 404)
      if (url === '/auth/invite-info') return jsonResponse({ email: invite.email, name: invite.name, expiresAt: '2026-02-01T00:00:00.000Z' })
      server.signedInAs = invite.session
      return jsonResponse(invite.session)
    }
    if (url === '/tenants') {
      if (usesKey || roles.includes('operator')) return jsonResponse({ tenants: [ACME] })
      if (wrongKey) return jsonResponse({ error: 'FORBIDDEN', message: 'Admin API key required' }, 403)
      return server.signedInAs ? jsonResponse({ error: 'FORBIDDEN', message: 'Operator access required' }, 403) : jsonResponse({ error: 'UNAUTHENTICATED' }, 401)
    }
    if (url === '/users') {
      if (usesKey || server.signedInAs) return jsonResponse({ users: [] })
      return jsonResponse({ error: 'UNAUTHENTICATED' }, 401)
    }
    return jsonResponse({ error: 'NOT_FOUND' }, 404)
  })
  return { server, fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl }
}

const accounts = {
  'op@example.com': operatorSession(),
  'mgr@example.com': managerSession('acme'),
  'new@example.com': { ...managerSession(), memberships: [] } as SessionInfo,
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password = 'correct horse') {
  await user.type(await screen.findByLabelText(/email/i), email)
  await user.type(screen.getByLabelText(/password/i), password)
  await user.click(screen.getByRole('button', { name: /^sign in$/i }))
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('App sign-in with an account', () => {
  it('asks the server for an existing session, then shows the sign-in page', async () => {
    const { fetchImpl, calls } = makeServer({ accounts })
    render(<App fetchImpl={fetchImpl} />)

    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith('/auth/me', expect.anything())
    expect(screen.queryByLabelText(/admin key/i)).not.toBeInTheDocument()
  })

  it('goes straight in when the browser already holds a session', async () => {
    const { fetchImpl } = makeServer({ accounts, signedInAs: accounts['op@example.com'] })
    render(<App fetchImpl={fetchImpl} />)

    expect(await screen.findByText('Olive Operator')).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('shows the server message for a wrong password and stays on the sign-in page', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)

    await signIn(user, 'op@example.com', 'nope')

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('keeps nothing about the person in sessionStorage or localStorage', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)

    await signIn(user, 'op@example.com')
    await screen.findByText('Olive Operator')

    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('signing out ends the session on the server and returns to the sign-in page', async () => {
    const user = userEvent.setup()
    const { fetchImpl, server } = makeServer({ accounts })
    render(<App fetchImpl={fetchImpl} />)
    await signIn(user, 'op@example.com')
    await screen.findByText('Olive Operator')

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument())
    expect(server.signedInAs).toBeNull()
  })

  it('goes back to the sign-in page with a clear message when the session expires', async () => {
    const user = userEvent.setup()
    const { fetchImpl, server } = makeServer({ accounts })
    render(<App fetchImpl={fetchImpl} />)
    await signIn(user, 'op@example.com')
    await screen.findByText('Acme Corp')

    server.signedInAs = null // the session timed out on the server
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/session has ended/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })
})

describe('what each role sees', () => {
  it('an operator gets the Tenants and Users screens', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeServer({ accounts, signedInAs: accounts['op@example.com'] }).fetchImpl} />)

    expect(await screen.findByRole('heading', { name: 'Tenants' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Users' }))
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
  })

  it('a tenant manager gets the Users screen only, with no way to reach the tenants', async () => {
    const { fetchImpl, calls } = makeServer({ accounts, signedInAs: accounts['mgr@example.com'] })
    render(<App fetchImpl={fetchImpl} />)

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tenants' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tenants' })).not.toBeInTheDocument()
    expect(calls).not.toHaveBeenCalledWith('/tenants', expect.anything())
  })

  it('someone with no roles is told so', async () => {
    render(<App fetchImpl={makeServer({ accounts, signedInAs: accounts['new@example.com'] }).fetchImpl} />)

    expect(await screen.findByText(/no roles yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('being refused (403) is not being signed out', async () => {
    const user = userEvent.setup()
    // operator at first; then the server starts answering 403 to tenant calls
    const { fetchImpl, server } = makeServer({ accounts, signedInAs: accounts['op@example.com'] })
    render(<App fetchImpl={fetchImpl} />)
    await screen.findByText('Acme Corp')

    server.signedInAs = accounts['mgr@example.com'] // roles changed behind our back
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Operator access required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })
})

describe('admin key (break-glass)', () => {
  async function useKey(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.click(await screen.findByRole('button', { name: /use the admin key/i }))
    await user.type(screen.getByLabelText(/admin key/i), key)
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
  }

  it('is behind an "advanced" link, not the first thing shown', async () => {
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)

    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/admin key/i)).not.toBeInTheDocument()
  })

  it('rejects a wrong key with a message', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)

    await useKey(user, 'wrong-key')

    expect(await screen.findByText(/admin key was rejected/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })

  it('accepts the right key, remembers it for the tab and acts as an operator', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)

    await useKey(user, 'right-key')

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBe('right-key')
  })

  it('uses a key remembered from earlier in the tab, without asking for a session', async () => {
    sessionStorage.setItem('nexus-console-admin-key', 'right-key')
    const { fetchImpl, calls } = makeServer({ accounts })
    render(<App fetchImpl={fetchImpl} />)

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(calls).not.toHaveBeenCalledWith('/auth/me', expect.anything())
  })

  it('signs out with an explanation when the key stops being accepted', async () => {
    const user = userEvent.setup()
    const { fetchImpl, server } = makeServer({ accounts })
    sessionStorage.setItem('nexus-console-admin-key', 'right-key')
    render(<App fetchImpl={fetchImpl} />)
    await screen.findByText('Acme Corp')

    server.adminKey = 'rotated-key'
    // a rotated key is a wrong key to the server, which answers tenant calls with 403 and others with 401
    const original = fetchImpl as unknown as ReturnType<typeof vi.fn>
    original.mockImplementationOnce(async () => jsonResponse({ error: 'UNAUTHENTICATED' }, 401))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/no longer accepted/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })

  it('signing out forgets the key', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('nexus-console-admin-key', 'right-key')
    render(<App fetchImpl={makeServer({ accounts }).fetchImpl} />)
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument())
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })
})

describe('invitation page', () => {
  const invite = { token: 'tok_123', email: 'new@example.com', name: 'Nora New', session: accounts['mgr@example.com'] }

  function open(token: string) {
    window.history.replaceState(null, '', `/console/invite/${token}`)
  }

  it('greets the invited person and signs them in once they choose a password', async () => {
    const user = userEvent.setup()
    open('tok_123')
    const { fetchImpl, calls } = makeServer({ accounts, invite })
    render(<App fetchImpl={fetchImpl} />)

    expect(await screen.findByText(/Hello Nora New/)).toBeInTheDocument()
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^new password/i), 'a long passphrase')
    await user.type(screen.getByLabelText(/^repeat the password/i), 'a long passphrase')
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    const accept = calls.mock.calls.find(([url]) => url === '/auth/accept-invite')!
    expect(JSON.parse((accept[1] as RequestInit).body as string)).toEqual({ token: 'tok_123', password: 'a long passphrase' })
  })

  it('takes the secret out of the address bar as soon as the page opens', async () => {
    open('tok_123')
    render(<App fetchImpl={makeServer({ accounts, invite }).fetchImpl} />)

    await screen.findByText(/Hello Nora New/)

    expect(window.location.pathname).toBe('/console/')
  })

  it('does not submit when the two passwords differ', async () => {
    const user = userEvent.setup()
    open('tok_123')
    const { fetchImpl, calls } = makeServer({ accounts, invite })
    render(<App fetchImpl={fetchImpl} />)
    await screen.findByText(/Hello Nora New/)

    await user.type(screen.getByLabelText(/^new password/i), 'one passphrase')
    await user.type(screen.getByLabelText(/^repeat the password/i), 'another passphrase')
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(calls).not.toHaveBeenCalledWith('/auth/accept-invite', expect.anything())
  })

  it('shows the server reason when the password is not accepted, and keeps the form', async () => {
    const user = userEvent.setup()
    open('tok_123')
    const { fetchImpl } = makeServer({ accounts, invite })
    const original = fetchImpl as unknown as ReturnType<typeof vi.fn>
    render(<App fetchImpl={fetchImpl} />)
    await screen.findByText(/Hello Nora New/)
    original.mockImplementationOnce(async () => jsonResponse({ error: 'WEAK_PASSWORD', message: 'Password must be at least 12 characters' }, 400))

    await user.type(screen.getByLabelText(/^new password/i), 'short')
    await user.type(screen.getByLabelText(/^repeat the password/i), 'short')
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument()
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument()
  })

  it('explains an invalid or used link and offers the sign-in page', async () => {
    const user = userEvent.setup()
    open('used-up')
    render(<App fetchImpl={makeServer({ accounts, invite }).fetchImpl} />)

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /go to sign-in/i }))
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
  })
})
