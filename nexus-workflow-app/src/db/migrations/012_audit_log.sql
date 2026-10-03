-- ─── Audit log ───────────────────────────────────────────────────────────────
-- Who did what to which tenant or person, for administrative actions and sign-ins. Append-only:
-- nothing here is updated or deleted by the application.
--
-- No foreign keys on purpose: an entry must outlive the tenant or person it is about (deleting a
-- tenant is exactly the kind of thing the log has to remember). The actor's label is kept on the
-- entry for the same reason.
-- Never stores passwords, tokens or plaintext keys (AuditLog also scrubs those out of `details`).

CREATE TABLE public.audit_log (
  id          TEXT        PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'user' (a signed-in person), 'adminKey' (ADMIN_API_KEY), 'apiKey' (a tenant API key), or
  -- 'anonymous' (nobody was signed in: a failed sign-in).
  actor_kind  TEXT        NOT NULL,
  -- A user's id, or an API key's id. NULL for the admin key and anonymous callers.
  actor_id    TEXT,
  -- Readable at the time: the person's email, the key's name, or the email that was tried.
  actor_label TEXT,
  -- e.g. tenant.create, key.revoke, user.disable, membership.add, login.failure
  action      TEXT        NOT NULL,
  -- The tenants the action is about; empty for platform-wide actions (a sign-in, creating an operator).
  -- A list, because one action can touch several (inviting a person who manages two tenants). A tenant
  -- manager reads an entry only if it lists tenants and *all* of them are theirs.
  tenant_ids  TEXT[]      NOT NULL DEFAULT '{}',
  -- What was acted on: a tenant id, key id, user id, ...
  target      TEXT,
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_log_actor_kind CHECK (actor_kind IN ('user', 'adminKey', 'apiKey', 'anonymous'))
);

CREATE INDEX audit_log_at_idx        ON public.audit_log (at DESC, id DESC);
CREATE INDEX audit_log_tenants_idx   ON public.audit_log USING GIN (tenant_ids);
CREATE INDEX audit_log_actor_at_idx  ON public.audit_log (actor_id, at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_log_action_at_idx ON public.audit_log (action, at DESC);
