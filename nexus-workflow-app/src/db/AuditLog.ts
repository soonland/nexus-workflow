import type postgres from 'postgres'

// ─── What an entry says ──────────────────────────────────────────────────────

/** Who acted. `label` is what a reader should see: it is kept on the entry, so it survives the person being deleted. */
export type AuditActor =
  | { kind: 'user'; id: string; label: string }
  | { kind: 'adminKey' }
  | { kind: 'apiKey'; id?: string; label?: string }
  | { kind: 'anonymous'; label?: string }

export interface AuditInput {
  /** Dotted, lower case: `tenant.create`, `key.revoke`, `login.failure`, ... */
  action: string
  actor: AuditActor
  /**
   * The tenants the action is about (none for platform-wide actions). A tenant manager reads an entry
   * only if it names tenants and every one of them is theirs.
   */
  tenantIds?: string[]
  /** What was acted on (a tenant id, a key id, a user id). */
  target?: string | null
  /** A few facts about the action. Never secrets: see `scrub`. */
  details?: Record<string, unknown>
}

export interface AuditEntry {
  id: string
  at: Date
  actor: { kind: AuditActor['kind']; id: string | null; label: string | null }
  action: string
  tenantIds: string[]
  target: string | null
  details: Record<string, unknown>
}

export interface AuditQuery {
  /**
   * Restrict to what a tenant manager of these tenants may read: entries that name tenants, all of them
   * in this list. Omit for no restriction (operators).
   */
  visibleToManagerOf?: string[]
  /** Only entries that involve this tenant. */
  tenantId?: string
  actor?: string
  /** An exact action (`key.revoke`) or a family (`key`, matching `key.create` and `key.revoke`). */
  action?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
}

// ─── Keeping secrets out ─────────────────────────────────────────────────────

/** Field names that must never reach the log, wherever they are in `details`. */
const FORBIDDEN_FIELD = /pass(word|phrase)?|secret|token|plaintext|hash|authorization|cookie|api[_-]?key$/i

/** Copies `value` without any field whose name suggests a secret. A last line of defence: callers pass only plain facts. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[too deep]'
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !FORBIDDEN_FIELD.test(key)).map(([key, item]) => [key, scrub(item, depth + 1)]))
  }
  return value
}

const LIMIT = 512
/** A short, single-line copy of text from outside (an email someone typed), so the log cannot be flooded or confused. */
const clip = (text: string | null | undefined): string | null => (text == null ? null : text.replace(/[\r\n\t]+/g, ' ').slice(0, LIMIT))

// ─── The log ─────────────────────────────────────────────────────────────────

interface Row {
  id: string
  at: Date
  actor_kind: AuditActor['kind']
  actor_id: string | null
  actor_label: string | null
  action: string
  tenant_ids: string[]
  target: string | null
  details: Record<string, unknown>
}

export class AuditLog {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Writes one entry. It never throws: by the time an entry is written the action has already
   * happened, and a failing log must not turn a successful action into an error. A failure is
   * reported on the console instead.
   */
  async record(input: AuditInput): Promise<void> {
    try {
      const { actor } = input
      const actorId = actor.kind === 'user' || actor.kind === 'apiKey' ? (actor.id ?? null) : null
      const actorLabel = actor.kind === 'adminKey' ? 'admin key' : clip('label' in actor ? actor.label : null)
      await this.sql`
        INSERT INTO public.audit_log (id, actor_kind, actor_id, actor_label, action, tenant_ids, target, details)
        VALUES (
          ${crypto.randomUUID()}, ${actor.kind}, ${actorId}, ${actorLabel}, ${input.action},
          ${[...new Set(input.tenantIds ?? [])]}, ${clip(input.target)},
          ${this.sql.json(scrub(input.details ?? {}) as postgres.JSONValue)}
        )
      `
    } catch (err) {
      console.error(`[audit] could not record '${input.action}':`, err)
    }
  }

  /** Newest first. */
  async list(query: AuditQuery): Promise<AuditPage> {
    const { sql } = this
    const conditions = [
      query.visibleToManagerOf
        ? sql`(cardinality(tenant_ids) > 0 AND tenant_ids <@ ${query.visibleToManagerOf}::text[])`
        : sql`TRUE`,
      query.tenantId ? sql`tenant_ids @> ARRAY[${query.tenantId}]::text[]` : sql`TRUE`,
      query.actor ? sql`(actor_id = ${query.actor} OR actor_kind = ${query.actor})` : sql`TRUE`,
      query.action ? sql`(action = ${query.action} OR action LIKE ${escapeLike(query.action) + '.%'})` : sql`TRUE`,
      query.from ? sql`at >= ${query.from}` : sql`TRUE`,
      query.to ? sql`at <= ${query.to}` : sql`TRUE`,
    ]
    const where = conditions.reduce((all, one) => sql`${all} AND ${one}`)

    const [rows, counted] = await Promise.all([
      sql<Row[]>`
        SELECT id, at, actor_kind, actor_id, actor_label, action, tenant_ids, target, details
        FROM public.audit_log WHERE ${where}
        ORDER BY at DESC, id DESC
        LIMIT ${query.pageSize} OFFSET ${query.page * query.pageSize}
      `,
      sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.audit_log WHERE ${where}`,
    ])

    return {
      entries: rows.map((row) => ({
        id: row.id,
        at: row.at,
        actor: { kind: row.actor_kind, id: row.actor_id, label: row.actor_label },
        action: row.action,
        tenantIds: row.tenant_ids,
        target: row.target,
        details: row.details,
      })),
      total: counted[0]?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    }
  }
}

/** So a `_` or `%` typed in a filter means itself, not "any character". */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)
