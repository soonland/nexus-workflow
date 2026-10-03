import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, createAdminApi, type AdminApi } from '../api/client'
import type { SessionInfo } from '../api/types'
import type { Session } from './roles'

const STORAGE_KEY = 'nexus-console-admin-key'

// The admin key is the break-glass way in. It is kept in sessionStorage, not localStorage, so it
// is forgotten when the tab is closed. Signing in as a person keeps nothing in the page at all:
// the session lives in an HttpOnly cookie that scripts cannot read.
function readStoredKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredKey(key: string | null): void {
  try {
    if (key === null) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Storage can be unavailable (private mode); the key then only lives for this page load.
  }
}

const STALE_KEY_MESSAGE = 'Your admin key is no longer accepted by the server. Please sign in again.'
const EXPIRED_SESSION_MESSAGE = 'Your session has ended. Please sign in again.'
const KEY_REJECTED_MESSAGE = 'The admin key was rejected. Check that it matches ADMIN_API_KEY on the server.'

interface AuthValue {
  api: AdminApi
  /** Null when nobody is signed in. */
  session: Session | null
  /** True while the console is asking the server whether a session already exists. */
  loading: boolean
  /** Why the session ended on its own (it expired, the key was rotated), for the sign-in page. */
  signedOutReason: string | null
  signInWithPassword(email: string, password: string): Promise<void>
  /** Verifies the key against the API and, if it is accepted, keeps it for this tab. */
  signInWithAdminKey(key: string): Promise<void>
  /** The person finished the invitation: the server has already signed them in. */
  completeInvite(token: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const userSession = ({ user, memberships }: SessionInfo): Session => ({ kind: 'user', user, memberships })

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [session, setSession] = useState<Session | null>(() => (readStoredKey() ? { kind: 'adminKey' } : null))
  // Without a remembered key the only way to know is to ask the server (the cookie is invisible to us)
  const [loading, setLoading] = useState(() => readStoredKey() === null)
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null)
  // The API client reads these through refs so it always sees the current values.
  const keyRef = useRef(readStoredKey())
  const sessionRef = useRef(session)

  const store = useCallback((next: Session | null, key: string | null = null) => {
    sessionRef.current = next
    keyRef.current = key
    writeStoredKey(key)
    setSession(next)
  }, [])

  const api = useMemo(
    () =>
      createAdminApi(() => keyRef.current, fetchImpl, {
        // The server stopped accepting what we hold: drop it instead of staying "signed in"
        onUnauthorized: () => {
          const current = sessionRef.current
          if (current === null) return
          store(null)
          setSignedOutReason(current.kind === 'adminKey' ? STALE_KEY_MESSAGE : EXPIRED_SESSION_MESSAGE)
        },
      }),
    [fetchImpl, store],
  )

  // Pick up a session from an earlier visit
  useEffect(() => {
    if (!loading) return
    let cancelled = false
    api
      .me()
      .then((info) => {
        if (!cancelled && info) store(userSession(info))
      })
      .catch(() => {
        // Not reachable right now: show the sign-in page, which will say so on the first attempt
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, loading, store])

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const info = await api.login(email, password)
      setSignedOutReason(null)
      store(userSession(info))
    },
    [api, store],
  )

  const signInWithAdminKey = useCallback(
    async (candidate: string) => {
      // Listing tenants needs the admin key, so a successful call proves the key is valid.
      try {
        await createAdminApi(() => candidate, fetchImpl).listTenants()
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) throw new ApiError(403, KEY_REJECTED_MESSAGE, 'FORBIDDEN')
        throw err
      }
      setSignedOutReason(null)
      store({ kind: 'adminKey' }, candidate)
    },
    [fetchImpl, store],
  )

  const completeInvite = useCallback(
    async (token: string, password: string) => {
      const info = await api.acceptInvite(token, password)
      setSignedOutReason(null)
      store(userSession(info))
    },
    [api, store],
  )

  const signOut = useCallback(async () => {
    const wasUser = sessionRef.current?.kind === 'user'
    store(null)
    setSignedOutReason(null)
    // Forget locally first; ending the session on the server is best effort (a dead one is fine)
    if (wasUser) await api.logout().catch(() => undefined)
  }, [api, store])

  const value = useMemo(
    () => ({ api, session, loading, signedOutReason, signInWithPassword, signInWithAdminKey, completeInvite, signOut }),
    [api, session, loading, signedOutReason, signInWithPassword, signInWithAdminKey, completeInvite, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
