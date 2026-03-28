-- ─── Compensation Records ─────────────────────────────────────────────────────
-- Stores a record for each completed task that has a compensation boundary event
-- attached, enabling the engine to trigger compensation handlers later.

CREATE TABLE compensation_records (
  instance_id  TEXT        NOT NULL,
  activity_id  TEXT        NOT NULL,
  token_id     TEXT        NOT NULL,
  handler_id   TEXT        NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instance_id, token_id)
);

CREATE INDEX compensation_records_instance_id_idx ON compensation_records (instance_id);
