CREATE TABLE webhook_registrations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT        NOT NULL,
  events      JSONB       NOT NULL DEFAULT '[]',
  secret      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
