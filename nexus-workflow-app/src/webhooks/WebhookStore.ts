import postgres from 'postgres'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookRegistration {
  id: string
  url: string
  /** Event type filter. Empty array means all events. */
  events: string[]
  /** Optional HMAC secret for request signing. */
  secret: string | null
  createdAt: Date
}

export interface CreateWebhookInput {
  url: string
  events?: string[] | undefined
  secret?: string | undefined
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface WebhookStore {
  save(input: CreateWebhookInput): Promise<WebhookRegistration>
  list(): Promise<WebhookRegistration[]>
  delete(id: string): Promise<boolean>
}

// ─── InMemoryWebhookStore ─────────────────────────────────────────────────────

export class InMemoryWebhookStore implements WebhookStore {
  private readonly registrations = new Map<string, WebhookRegistration>()

  async save(input: CreateWebhookInput): Promise<WebhookRegistration> {
    const reg: WebhookRegistration = {
      id: crypto.randomUUID(),
      url: input.url,
      events: input.events ?? [],
      secret: input.secret ?? null,
      createdAt: new Date(),
    }
    this.registrations.set(reg.id, reg)
    return reg
  }

  async list(): Promise<WebhookRegistration[]> {
    return [...this.registrations.values()]
  }

  async delete(id: string): Promise<boolean> {
    return this.registrations.delete(id)
  }
}

// ─── PostgresWebhookStore ─────────────────────────────────────────────────────

export class PostgresWebhookStore implements WebhookStore {
  private readonly sql: postgres.Sql

  constructor(connectionString: string) {
    this.sql = postgres(connectionString)
  }

  async save(input: CreateWebhookInput): Promise<WebhookRegistration> {
    const events = input.events ?? []
    const secret = input.secret ?? null
    const rows = await this.sql<Array<{
      id: string
      url: string
      events: string[]
      secret: string | null
      created_at: Date
    }>>`
      INSERT INTO webhook_registrations (url, events, secret)
      VALUES (${input.url}, ${this.sql.json(events)}, ${secret})
      RETURNING id, url, events, secret, created_at
    `
    const row = rows[0]
    if (!row) throw new Error('INSERT did not return a row')
    return mapRow(row)
  }

  async list(): Promise<WebhookRegistration[]> {
    const rows = await this.sql<Array<{
      id: string
      url: string
      events: string[]
      secret: string | null
      created_at: Date
    }>>`
      SELECT id, url, events, secret, created_at
      FROM webhook_registrations
      ORDER BY created_at ASC
    `
    return rows.map(mapRow)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM webhook_registrations WHERE id = ${id}
    `
    return result.count > 0
  }
}

function mapRow(row: {
  id: string
  url: string
  events: string[]
  secret: string | null
  created_at: Date
}): WebhookRegistration {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    secret: row.secret,
    createdAt: new Date(row.created_at),
  }
}
