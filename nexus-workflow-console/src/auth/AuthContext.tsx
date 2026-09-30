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

interface AuthValue {
  api: AdminApi
  isSignedIn: boolean
  /** Verifies the key against the API and, if it is accepted, keeps it for this session. */
  signIn(key: string): Promise<void>
  signOut(): void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [key, setKey] = useState<string | null>(readStoredKey)
  // The API client reads the key through a ref so it always sees the current one.
  const keyRef = useRef(key)

  const api = useMemo(() => createAdminApi(() => keyRef.current, fetchImpl), [fetchImpl])

  const signIn = useCallback(
    async (candidate: string) => {
      // Listing tenants needs the admin key, so a successful call proves the key is valid.
      await createAdminApi(() => candidate, fetchImpl).listTenants()
      keyRef.current = candidate
      writeStoredKey(candidate)
      setKey(candidate)
    },
    [fetchImpl],
  )

  const signOut = useCallback(() => {
    keyRef.current = null
    writeStoredKey(null)
    setKey(null)
  }, [])

  const value = useMemo(() => ({ api, isSignedIn: key !== null, signIn, signOut }), [api, key, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
