-- ─── Tenant-scoped execution events and webhooks ─────────────────────────────
-- execution_events and webhook_registrations used to live in the shared public
-- schema with no tenant column, so every tenant could read every other tenant's
-- events and webhooks. Move them into each tenant's own schema.
--
-- For every tenant that already has a schema:
--   1. create both tables in that schema
--   2. copy the events that belong to the tenant (their instance_id exists in
--      the tenant's instances table)
-- Then, into tenant_default:
--   3. copy the events that could not be attributed to any tenant (no
--      instance_id, or the instance no longer exists)
--   4. copy all webhook registrations (they carry no tenant information, so
--      they are handed to the default tenant)
-- Finally drop the shared tables.

CREATE TEMP TABLE _attributed_events (id TEXT PRIMARY KEY) ON COMMIT DROP;

DO $$
DECLARE
  t RECORD;
  s TEXT;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    s := 'tenant_' || t.id;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.execution_events (
         id          TEXT        PRIMARY KEY,
         instance_id TEXT,
         type        TEXT        NOT NULL,
         occurred_at TIMESTAMPTZ NOT NULL,
         data        JSONB       NOT NULL
       )', s);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS execution_events_instance_id_idx ON %I.execution_events (instance_id) WHERE instance_id IS NOT NULL', s);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS execution_events_occurred_at_idx ON %I.execution_events (occurred_at)', s);
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.webhook_registrations (
         id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
         url         TEXT        NOT NULL,
         events      JSONB       NOT NULL DEFAULT ''[]'',
         secret      TEXT,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )', s);

    -- Events of this tenant's instances
    EXECUTE format(
      'INSERT INTO _attributed_events (id)
       SELECT e.id FROM public.execution_events e
       WHERE e.instance_id IN (SELECT i.id FROM %I.instances i)
       ON CONFLICT (id) DO NOTHING', s);
    EXECUTE format(
      'INSERT INTO %I.execution_events (id, instance_id, type, occurred_at, data)
       SELECT e.id, e.instance_id, e.type, e.occurred_at, e.data
       FROM public.execution_events e
       WHERE e.instance_id IN (SELECT i.id FROM %I.instances i)
       ON CONFLICT (id) DO NOTHING', s, s);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_default') THEN
    INSERT INTO tenant_default.execution_events (id, instance_id, type, occurred_at, data)
    SELECT e.id, e.instance_id, e.type, e.occurred_at, e.data
    FROM public.execution_events e
    WHERE e.id NOT IN (SELECT a.id FROM _attributed_events a)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO tenant_default.webhook_registrations (id, url, events, secret, created_at)
    SELECT w.id, w.url, w.events, w.secret, w.created_at
    FROM public.webhook_registrations w
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DROP TABLE public.execution_events;
DROP TABLE public.webhook_registrations;
