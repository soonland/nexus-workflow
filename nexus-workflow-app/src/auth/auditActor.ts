import type { AuditActor } from '../db/AuditLog.js'
import type { Principal } from './principal.js'

/** How a request's principal is written in the audit log. */
export function auditActorOf(principal: Principal): AuditActor {
  switch (principal.kind) {
    case 'user':
      return { kind: 'user', id: principal.user.id, label: principal.user.email }
    case 'adminKey':
      return { kind: 'adminKey' }
    case 'apiKey':
      // The principal knows the tenant but not which of its keys was used
      return { kind: 'apiKey', label: `API key of tenant ${principal.tenantId}` }
  }
}
