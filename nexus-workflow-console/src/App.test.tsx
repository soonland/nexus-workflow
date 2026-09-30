import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fake server: /tenants only answers when the right admin key is presented. */
function makeFetch(adminKey = 'right-key') {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
    if (auth !== `Bearer ${adminKey}`) return jsonResponse({ error: 'FORBIDDEN' }, 403)
    return jsonResponse({
      tenants: [{ id: 'acme', name: 'Acme Corp', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', activeKeyCount: 2 }],
    })
  })
}

describe('App sign-in', () => {
  it('shows the sign-in page first and does not call the API', () => {
    const fetchImpl = makeFetch()
    render(<App fetchImpl={fetchImpl as unknown as typeof fetch} />)

    expect(screen.getByLabelText(/admin key/i)).toBeInTheDocument()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a wrong key with a message and stays on the sign-in page', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeFetch() as unknown as typeof fetch} />)

    await user.type(screen.getByLabelText(/admin key/i), 'wrong-key')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/admin key was rejected/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tenants' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })

  it('accepts the right key, remembers it for the tab and shows the tenants', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeFetch() as unknown as typeof fetch} />)

    await user.type(screen.getByLabelText(/admin key/i), 'right-key')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: 'Tenants' })).toBeInTheDocument()
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBe('right-key')
  })

  it('uses a key remembered from earlier in the tab', async () => {
    sessionStorage.setItem('nexus-console-admin-key', 'right-key')
    render(<App fetchImpl={makeFetch() as unknown as typeof fetch} />)

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(screen.queryByLabelText(/admin key/i)).not.toBeInTheDocument()
  })

  it('signing out forgets the key and returns to the sign-in page', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('nexus-console-admin-key', 'right-key')
    render(<App fetchImpl={makeFetch() as unknown as typeof fetch} />)
    await screen.findByText('Acme Corp')

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByLabelText(/admin key/i)).toBeInTheDocument())
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })
  it('signs out with an explanation when the key stops being accepted after sign-in', async () => {
    const user = userEvent.setup()
    let accepted = true
    const fetchImpl = vi.fn(async () =>
      accepted
        ? jsonResponse({ tenants: [{ id: 'acme', name: 'Acme Corp', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', activeKeyCount: 0 }] })
        : jsonResponse({ error: 'FORBIDDEN' }, 403),
    )
    render(<App fetchImpl={fetchImpl as unknown as typeof fetch} />)
    await user.type(screen.getByLabelText(/admin key/i), 'right-key')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await screen.findByText('Acme Corp')

    accepted = false // e.g. the server's ADMIN_API_KEY was rotated
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/no longer accepted/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/admin key/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('nexus-console-admin-key')).toBeNull()
  })

  it('does not show the "no longer accepted" message for a plain wrong key at sign-in', async () => {
    const user = userEvent.setup()
    render(<App fetchImpl={makeFetch() as unknown as typeof fetch} />)

    await user.type(screen.getByLabelText(/admin key/i), 'wrong-key')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/admin key was rejected/i)).toBeInTheDocument()
    expect(screen.queryByText(/no longer accepted/i)).not.toBeInTheDocument()
  })
})
