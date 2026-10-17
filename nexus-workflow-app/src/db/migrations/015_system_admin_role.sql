-- ─── The system_admin role ───────────────────────────────────────────────────
-- A third platform role above `operator`. It is platform-wide (no tenant) and is never granted
-- through the API or the console: only the `system-admin:create` command line does it. A system
-- admin is the only role that can create, disable or remove operators; operators are limited to
-- tenant managers.
--
-- Existing operators are unchanged. Nobody is a system admin until the command is run.

ALTER TABLE public.memberships DROP CONSTRAINT memberships_role_scope;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_role_scope CHECK (
    (role IN ('operator', 'system_admin') AND tenant_id IS NULL)
    OR (role = 'tenant_manager' AND tenant_id IS NOT NULL)
  );

-- One system_admin membership per user, like operator (NULL tenant ids never collide in a plain unique constraint).
CREATE UNIQUE INDEX memberships_one_system_admin_per_user ON public.memberships (user_id) WHERE role = 'system_admin';
