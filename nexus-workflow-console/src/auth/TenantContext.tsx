import { useCallback, useMemo, useState } from 'react'
import type { TenantApi } from '../api/client'
import { useAuth } from './AuthContext'
import { managedTenantIds } from './roles'

const STORAGE_KEY = 'nexus-console-tenant'

// Remembered per tab, so a refresh keeps you where you were; never shared between tabs
function readChoice(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeChoice(tenantId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, tenantId)
  } catch {
    // Unavailable (private mode): the choice then only lasts for this page load
  }
}

export interface TenantContextValue {
  /** The tenants the signed-in person manages, sorted. Empty for operators and the admin key. */
  tenantIds: string[]
  /** The tenant the tenant screens work in, or null if the person manages none. */
  tenantId: string | null
  select(tenantId: string): void
  /** Calls for the selected tenant (each names it in X-Tenant). Null if there is no tenant. */
  api: TenantApi | null
}

/**
 * Which tenant a tenant manager is working in. With one tenant there is nothing to choose; with
 * several, the choice is remembered for the tab. A remembered tenant the person no longer manages
 * is ignored.
 */
export function useTenantContext(): TenantContextValue {
  const { session, tenantApi } = useAuth()
  const tenantIds = useMemo(() => (session ? managedTenantIds(session).sort() : []), [session])
  const [choice, setChoice] = useState<string | null>(readChoice)

  const tenantId = choice && tenantIds.includes(choice) ? choice : (tenantIds[0] ?? null)
  const api = useMemo(() => (tenantId ? tenantApi(tenantId) : null), [tenantApi, tenantId])

  const select = useCallback((id: string) => {
    writeChoice(id)
    setChoice(id)
  }, [])

  return { tenantIds, tenantId, select, api }
}
