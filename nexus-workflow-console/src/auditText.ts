import type { AuditEntry } from './api/types'

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const roleText = (details: Record<string, unknown>) => {
  const role = text(details['role'])
  const tenant = text(details['tenantId'])
  if (role === 'operator') return 'operator'
  if (role === 'tenant_manager') return tenant ? `manager of ${tenant}` : 'tenant manager'
  return role ?? 'a role'
}

/** What happened, in a sentence. Unknown actions fall back to their code, so nothing is ever hidden. */
export function describeAudit(entry: AuditEntry): string {
  const d = entry.details
  const who = text(d['email']) ?? entry.target ?? 'someone'

  switch (entry.action) {
    case 'tenant.create':
      return `Created tenant ${entry.target ?? ''}`.trim()
    case 'tenant.suspend':
      return `Suspended tenant ${entry.target ?? ''}`.trim()
    case 'tenant.reactivate':
      return `Reactivated tenant ${entry.target ?? ''}`.trim()
    case 'tenant.rename':
      return `Renamed tenant ${entry.target ?? ''}${text(d['name']) ? ` to "${text(d['name'])}"` : ''}`.trim()
    case 'tenant.delete':
      return `Deleted tenant ${entry.target ?? ''}`.trim()
    case 'key.create':
      return `Created API key${text(d['name']) ? ` "${text(d['name'])}"` : ''}${text(d['role']) ? ` (${text(d['role'])})` : ''}`
    case 'key.role':
      return `Changed the role of API key${text(d['name']) ? ` "${text(d['name'])}"` : ''} from ${text(d['from']) ?? '?'} to ${text(d['to']) ?? '?'}`
    case 'key.revoke':
      return 'Revoked an API key'
    case 'user.create':
      return `Invited ${who}`
    case 'user.disable':
      return `Disabled ${who}`
    case 'user.enable':
      return `Enabled ${who}`
    case 'membership.add':
      return `Gave ${who} the role ${roleText(d)}`
    case 'membership.remove':
      return `Removed the role ${roleText(d)} from ${who}`
    case 'invite.create':
      return d['reset'] === true ? `Issued a new invitation (password reset) for ${who}` : `Issued a new invitation for ${who}`
    case 'invite.accept':
      return 'Accepted their invitation'
    case 'step.force': {
      const element = text(d['elementId'])
      const behalf = text(d['onBehalfOf'])
      const reason = text(d['reason'])
      return `Pushed ${element ? `step ${element}` : 'a step'} along by hand${behalf ? ` for ${behalf}` : ''}${reason ? `: “${reason}”` : ''}`
    }
    case 'login.success':
      return 'Signed in'
    case 'login.failure':
      return `Failed sign-in${text(d['reason']) ? ` (${text(d['reason'])})` : ''}`
    default:
      return entry.action
  }
}

/** The recorded facts as one line, without the ones the sentence already says. */
export function auditFacts(entry: AuditEntry): string {
  const already = new Set(['email', 'name', 'role', 'tenantId', 'reset', 'reason'])
  return Object.entries(entry.details)
    .filter(([key]) => !already.has(key))
    .map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
}

export const ACTION_FAMILIES = [
  { value: 'tenant', label: 'Tenants' },
  { value: 'key', label: 'API keys' },
  { value: 'user', label: 'People' },
  { value: 'membership', label: 'Roles' },
  { value: 'invite', label: 'Invitations' },
  { value: 'step', label: 'Forced steps' },
  { value: 'login', label: 'Sign-ins' },
] as const
