-- ─── Process Definitions ─────────────────────────────────────────────────────

CREATE TABLE definitions (
  id            TEXT        NOT NULL,
  version       INTEGER     NOT NULL,
  name          TEXT,
  deployed_at   TIMESTAMPTZ NOT NULL,
  is_deployable BOOLEAN     NOT NULL,
  data          JSONB       NOT NULL,
  PRIMARY KEY (id, version)
);

-- ─── Process Instances ────────────────────────────────────────────────────────

CREATE TABLE instances (
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

CREATE INDEX instances_definition_id_idx    ON instances (definition_id);
CREATE INDEX instances_status_idx           ON instances (status);
CREATE INDEX instances_correlation_key_idx  ON instances (correlation_key) WHERE correlation_key IS NOT NULL;
CREATE INDEX instances_business_key_idx     ON instances (business_key)    WHERE business_key IS NOT NULL;
CREATE INDEX instances_started_at_idx       ON instances (started_at);

-- ─── Tokens ───────────────────────────────────────────────────────────────────

CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  data        JSONB NOT NULL
);

CREATE INDEX tokens_instance_id_idx     ON tokens (instance_id);
CREATE INDEX tokens_instance_status_idx ON tokens (instance_id, status);

-- ─── Variable Scopes ──────────────────────────────────────────────────────────

CREATE TABLE variable_scopes (
  id              TEXT PRIMARY KEY,
  parent_scope_id TEXT,
  data            JSONB NOT NULL
);

-- ─── User Tasks ───────────────────────────────────────────────────────────────

CREATE TABLE user_tasks (
  id          TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  assignee    TEXT,
  status      TEXT NOT NULL,
  data        JSONB NOT NULL
);

CREATE INDEX user_tasks_instance_id_idx ON user_tasks (instance_id);
CREATE INDEX user_tasks_assignee_idx    ON user_tasks (assignee) WHERE assignee IS NOT NULL;
CREATE INDEX user_tasks_status_idx      ON user_tasks (status);

-- ─── Event Subscriptions ──────────────────────────────────────────────────────

CREATE TABLE event_subscriptions (
  id                TEXT PRIMARY KEY,
  instance_id       TEXT NOT NULL,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL,
  message_name      TEXT,
  signal_name       TEXT,
  correlation_value TEXT,
  data              JSONB NOT NULL
);

CREATE INDEX event_subscriptions_instance_id_idx       ON event_subscriptions (instance_id);
CREATE INDEX event_subscriptions_type_idx              ON event_subscriptions (type);
CREATE INDEX event_subscriptions_message_name_idx      ON event_subscriptions (message_name)      WHERE message_name IS NOT NULL;
CREATE INDEX event_subscriptions_signal_name_idx       ON event_subscriptions (signal_name)       WHERE signal_name IS NOT NULL;
CREATE INDEX event_subscriptions_correlation_value_idx ON event_subscriptions (correlation_value) WHERE correlation_value IS NOT NULL;

-- ─── Gateway Join States ──────────────────────────────────────────────────────

CREATE TABLE gateway_join_states (
  gateway_id  TEXT  NOT NULL,
  instance_id TEXT  NOT NULL,
  data        JSONB NOT NULL,
  PRIMARY KEY (gateway_id, instance_id)
);

-- ─── History Entries ──────────────────────────────────────────────────────────

CREATE TABLE history_entries (
  id          TEXT PRIMARY KEY,
  instance_id TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  data        JSONB       NOT NULL
);

CREATE INDEX history_entries_instance_id_idx ON history_entries (instance_id);

-- ─── Scheduled Timers ─────────────────────────────────────────────────────────

CREATE TABLE scheduled_timers (
  id          TEXT PRIMARY KEY,
  instance_id TEXT        NOT NULL,
  fire_at     TIMESTAMPTZ NOT NULL,
  data        JSONB       NOT NULL
);

CREATE INDEX scheduled_timers_fire_at_idx ON scheduled_timers (fire_at);
