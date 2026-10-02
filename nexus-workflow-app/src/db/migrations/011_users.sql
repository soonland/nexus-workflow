-- ─── User accounts, memberships, sessions and invites ────────────────────────
-- People (as opposed to API keys) who sign in to the platform. A user holds any number of
-- memberships: `operator` (platform-wide, no tenant) and/or `tenant_manager` (one tenant each).
-- Rules that must always hold are constraints here, not only checks in application code.

CREATE TABLE public.users (
  id            TEXT        PRIMARY KEY,
  -- Stored canonical (trimmed, lower-case), so a plain unique constraint makes it case-insensitive.
  email         TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  -- scrypt hash (see PasswordHasher); NULL until the person accepts their invite.
  password_hash TEXT,
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_email_canonical CHECK (
    email = lower(btrim(email)) AND length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  CONSTRAINT users_name_not_blank CHECK (btrim(name) <> '' AND length(name) <= 255),
  CONSTRAINT users_status_check   CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE public.memberships (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  role       TEXT        NOT NULL,
  -- NULL for platform-wide roles. Memberships disappear with their tenant.
  tenant_id  TEXT                 REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_scope CHECK (
    (role = 'operator'       AND tenant_id IS NULL)
    OR (role = 'tenant_manager' AND tenant_id IS NOT NULL)
  )
);

-- Postgres does not index foreign keys by itself; these make joins and cascades cheap.
CREATE INDEX memberships_user_id_idx   ON public.memberships (user_id);
CREATE INDEX memberships_tenant_id_idx ON public.memberships (tenant_id) WHERE tenant_id IS NOT NULL;
-- NULL tenant ids never collide in a plain unique constraint, so one partial index per shape.
CREATE UNIQUE INDEX memberships_one_operator_per_user      ON public.memberships (user_id)            WHERE role = 'operator';
CREATE UNIQUE INDEX memberships_one_manager_per_user_tenant ON public.memberships (user_id, tenant_id) WHERE role = 'tenant_manager';

CREATE TABLE public.sessions (
  -- HMAC of the session token; the token itself is never stored.
  token_hash   TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);

CREATE INDEX sessions_user_id_idx    ON public.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON public.sessions (expires_at);

CREATE TABLE public.invites (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- HMAC of the one-time invite token.
  token_hash TEXT        NOT NULL UNIQUE,
  created_by TEXT                 REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX invites_user_id_idx    ON public.invites (user_id);
CREATE INDEX invites_created_by_idx ON public.invites (created_by) WHERE created_by IS NOT NULL;
