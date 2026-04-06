-- ─── Tenant Registry ─────────────────────────────────────────────────────────
-- Stores tenants and their associated API keys. Each bearer token is stored as
-- a SHA-256 hash; the raw key is never persisted.

CREATE TABLE public.tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.api_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES public.tenants(id),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,  -- SHA-256 of the raw bearer token
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX api_keys_tenant_id_idx ON public.api_keys (tenant_id);
