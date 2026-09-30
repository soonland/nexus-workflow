-- ─── Tenant "deleting" status ────────────────────────────────────────────────
-- DELETE /tenants/:id marks the tenant "deleting" before it stops the tenant's workers and
-- drops its schema. The status is stored, so it survives a crash: a half-finished delete stays
-- visible, blocks reactivation, and can be finished by retrying DELETE. Like "suspended" it
-- makes the auth middleware reject the tenant's keys.

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'deleting'));
