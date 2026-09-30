import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAdminApi, type AdminApi } from '../api/client'

const STORAGE_KEY = 'nexus-console-admin-key'

// sessionStorage, not localStorage: the admin key is forgotten when the tab is closed.
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

interface AuthValue {
  api: AdminApi
  isSignedIn: boolean
  /** Why the session ended on its own (e.g. the key was rotated), for the sign-in page to show. */
  signedOutReason: string | null
  /** Verifies the key against the API and, if it is accepted, keeps it for this session. */
  signIn(key: string): Promise<void>
  signOut(): void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [key, setKey] = useState<string | null>(readStoredKey)
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null)
  // The API client reads the key through a ref so it always sees the current one.
  const keyRef = useRef(key)

  const endSession = useCallback((reason: string | null) => {
    keyRef.current = null
    writeStoredKey(null)
    setKey(null)
    setSignedOutReason(reason)
  }, [])

  const api = useMemo(
    () =>
      createAdminApi(() => keyRef.current, fetchImpl, {
        // The server stopped accepting the key we hold: drop it instead of staying "signed in"
        onUnauthorized: () => {
          if (keyRef.current !== null) endSession(STALE_KEY_MESSAGE)
        },
      }),
    [fetchImpl, endSession],
  )

  const signIn = useCallback(
    async (candidate: string) => {
      // Listing tenants needs the admin key, so a successful call proves the key is valid.
      await createAdminApi(() => candidate, fetchImpl).listTenants()
      keyRef.current = candidate
      writeStoredKey(candidate)
      setSignedOutReason(null)
      setKey(candidate)
    },
    [fetchImpl],
  )

  const signOut = useCallback(() => endSession(null), [endSession])

  const value = useMemo(
    () => ({ api, isSignedIn: key !== null, signedOutReason, signIn, signOut }),
    [api, key, signedOutReason, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
