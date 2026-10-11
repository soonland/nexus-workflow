-- ─── Operator keys ───────────────────────────────────────────────────────────
-- Named, revocable, database-backed credentials for programs that administer the platform (tenants,
-- people, audit log). They replace the single shared ADMIN_API_KEY as the normal way in; the admin
-- key stays as break-glass.
--
-- A table of their own, not api_keys with a NULL tenant, on purpose: a tenant key lookup can then
-- never return an operator key, so no route can accept one as a tenant credential by mistake.
-- Like every key, only a hash is stored. Keys carry the prefix `nxop_`.

CREATE TABLE public.operator_keys (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  -- The person who created it; NULL for the admin key, or once that person is deleted.
  created_by   TEXT        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  -- Optional. An expired key is refused like a revoked one.
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  CONSTRAINT operator_keys_name_not_blank CHECK (btrim(name) <> '' AND length(name) <= 255)
);

-- The audit log learns the new kind of actor
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_actor_kind;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_kind
  CHECK (actor_kind IN ('user', 'adminKey', 'operatorKey', 'apiKey', 'anonymous'));
