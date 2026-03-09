CREATE TABLE execution_events (
  id          TEXT        PRIMARY KEY,
  instance_id TEXT,
  type        TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  data        JSONB       NOT NULL
);

CREATE INDEX execution_events_instance_id_idx ON execution_events (instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX execution_events_occurred_at_idx ON execution_events (occurred_at);
