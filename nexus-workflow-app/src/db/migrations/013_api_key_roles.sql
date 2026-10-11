-- ─── Roles on API keys ───────────────────────────────────────────────────────
-- A tenant key now has a role, so a program can be given only what it needs:
--   service         the runtime API: start and read instances, tasks, events, messages and
--                   signals, and deploy / read definitions.
--   tenant_manager  everything in its tenant, as before: also webhooks, metrics, and the
--                   administrative commands (suspend, resume, restart, cancel, delete a definition).
--
-- Every key written before this migration becomes `service` (least privilege, as decided on #407).
-- A key whose program needs more is raised, without changing its secret, by an operator
-- (PATCH /tenants/:id/keys/:keyId), or replaced by a new key.

ALTER TABLE public.api_keys
  ADD COLUMN role TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_role_check CHECK (role IN ('service', 'tenant_manager'));

COMMENT ON COLUMN public.api_keys.created_by IS 'The person who created the key; NULL for the admin key or the command line, or once that person is deleted.';
