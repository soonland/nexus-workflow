import type postgres from 'postgres'

/**
 * Creates a tenant schema and all workflow tables within it.
 *
 * This is the canonical DDL for a tenant's data — used by provisionTenantSchema
 * when onboarding a new tenant. Migration 008 moves existing public-schema data
 * to `tenant_default` instead of calling this function (the tables already exist).
 *
 * Tables created:
 *   definitions, instances, tokens, variable_scopes, user_tasks,
 *   event_subscriptions, gateway_join_states, history_entries,
 *   scheduled_timers, compensation_records
 *
 * Tables NOT created here (they live in public and are shared):
 *   execution_events, webhook_registrations, schema_migrations, tenants, api_keys
 */
export async function createTenantSchema(sql: postgres.Sql, schemaName: string): Promise<void> {
  // schemaName is validated by the caller (provisionTenantSchema) before reaching here.
  // Using sql.unsafe is required because postgres.js does not support identifier
  // interpolation via tagged templates. The caller guarantees schemaName is safe.
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS "${schemaName}";

    -- ─── Process Definitions ───────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".definitions (
      id            TEXT        NOT NULL,
      version       INTEGER     NOT NULL,
      name          TEXT,
      deployed_at   TIMESTAMPTZ NOT NULL,
      is_deployable BOOLEAN     NOT NULL,
      data          JSONB       NOT NULL,
      source_xml    TEXT,
      PRIMARY KEY (id, version)
    );

    -- ─── Process Instances ─────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".instances (
      id                  TEXT        PRIMARY KEY,
      definition_id       TEXT        NOT NULL,
      definition_version  INTEGER     NOT NULL,
      status              TEXT        NOT NULL,
      correlation_key     TEXT,
      business_key        TEXT,
      started_at          TIMESTAMPTZ NOT NULL,
      completed_at        TIMESTAMPTZ,
      data                JSONB       NOT NULL
    );

    CREATE INDEX IF NOT EXISTS instances_definition_id_idx    ON "${schemaName}".instances (definition_id);
    CREATE INDEX IF NOT EXISTS instances_status_idx           ON "${schemaName}".instances (status);
    CREATE INDEX IF NOT EXISTS instances_correlation_key_idx  ON "${schemaName}".instances (correlation_key) WHERE correlation_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS instances_business_key_idx     ON "${schemaName}".instances (business_key)    WHERE business_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS instances_started_at_idx       ON "${schemaName}".instances (started_at);

    -- ─── Tokens ────────────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".tokens (
      id          TEXT  PRIMARY KEY,
      instance_id TEXT  NOT NULL,
      status      TEXT  NOT NULL,
      data        JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tokens_instance_id_idx     ON "${schemaName}".tokens (instance_id);
    CREATE INDEX IF NOT EXISTS tokens_instance_status_idx ON "${schemaName}".tokens (instance_id, status);

    -- ─── Variable Scopes ───────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".variable_scopes (
      id              TEXT  PRIMARY KEY,
      parent_scope_id TEXT,
      data            JSONB NOT NULL
    );

    -- ─── User Tasks ────────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".user_tasks (
      id          TEXT  PRIMARY KEY,
      instance_id TEXT  NOT NULL,
      assignee    TEXT,
      status      TEXT  NOT NULL,
      data        JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS user_tasks_instance_id_idx ON "${schemaName}".user_tasks (instance_id);
    CREATE INDEX IF NOT EXISTS user_tasks_assignee_idx    ON "${schemaName}".user_tasks (assignee) WHERE assignee IS NOT NULL;
    CREATE INDEX IF NOT EXISTS user_tasks_status_idx      ON "${schemaName}".user_tasks (status);

    -- ─── Event Subscriptions ───────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".event_subscriptions (
      id                TEXT  PRIMARY KEY,
      instance_id       TEXT  NOT NULL,
      type              TEXT  NOT NULL,
      status            TEXT  NOT NULL,
      message_name      TEXT,
      signal_name       TEXT,
      correlation_value TEXT,
      data              JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS event_subscriptions_instance_id_idx       ON "${schemaName}".event_subscriptions (instance_id);
    CREATE INDEX IF NOT EXISTS event_subscriptions_type_idx              ON "${schemaName}".event_subscriptions (type);
    CREATE INDEX IF NOT EXISTS event_subscriptions_message_name_idx      ON "${schemaName}".event_subscriptions (message_name)      WHERE message_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS event_subscriptions_signal_name_idx       ON "${schemaName}".event_subscriptions (signal_name)       WHERE signal_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS event_subscriptions_correlation_value_idx ON "${schemaName}".event_subscriptions (correlation_value) WHERE correlation_value IS NOT NULL;

    -- ─── Gateway Join States ───────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".gateway_join_states (
      gateway_id  TEXT  NOT NULL,
      instance_id TEXT  NOT NULL,
      data        JSONB NOT NULL,
      PRIMARY KEY (gateway_id, instance_id)
    );

    CREATE INDEX IF NOT EXISTS gateway_join_states_instance_id_idx ON "${schemaName}".gateway_join_states (instance_id);

    -- ─── History Entries ───────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".history_entries (
      id          TEXT        PRIMARY KEY,
      instance_id TEXT        NOT NULL,
      started_at  TIMESTAMPTZ NOT NULL,
      data        JSONB       NOT NULL
    );

    CREATE INDEX IF NOT EXISTS history_entries_instance_id_idx ON "${schemaName}".history_entries (instance_id);

    -- ─── Scheduled Timers ──────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".scheduled_timers (
      id          TEXT        PRIMARY KEY,
      instance_id TEXT        NOT NULL,
      fire_at     TIMESTAMPTZ NOT NULL,
      data        JSONB       NOT NULL
    );

    CREATE INDEX IF NOT EXISTS scheduled_timers_fire_at_idx ON "${schemaName}".scheduled_timers (fire_at);

    -- ─── Compensation Records ──────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS "${schemaName}".compensation_records (
      instance_id  TEXT        NOT NULL,
      activity_id  TEXT        NOT NULL,
      token_id     TEXT        NOT NULL,
      handler_id   TEXT        NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (instance_id, token_id)
    );

    CREATE INDEX IF NOT EXISTS compensation_records_instance_id_idx ON "${schemaName}".compensation_records (instance_id);
  `)
}
