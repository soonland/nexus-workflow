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
      return { kind: 'apiKey', id: principal.keyId, label: `${principal.keyName} (key of ${principal.tenantId})` }
  }
}
