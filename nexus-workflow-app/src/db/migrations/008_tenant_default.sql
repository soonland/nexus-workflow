-- ─── Schema-Per-Tenant: Default Tenant Migration ─────────────────────────────
-- Moves all per-tenant workflow tables out of the public schema into a dedicated
-- tenant_default schema, and seeds the public.tenants registry with the default
-- tenant row.
--
-- Tables moved to tenant_default:
--   definitions, instances, tokens, variable_scopes, user_tasks,
--   event_subscriptions, gateway_join_states, history_entries,
--   scheduled_timers, compensation_records
--
-- Tables that remain in public (shared / cross-tenant concerns):
--   schema_migrations, tenants, api_keys, execution_events, webhook_registrations

CREATE SCHEMA IF NOT EXISTS tenant_default;

ALTER TABLE public.definitions        SET SCHEMA tenant_default;
ALTER TABLE public.instances          SET SCHEMA tenant_default;
ALTER TABLE public.tokens             SET SCHEMA tenant_default;
ALTER TABLE public.variable_scopes    SET SCHEMA tenant_default;
ALTER TABLE public.user_tasks         SET SCHEMA tenant_default;
ALTER TABLE public.event_subscriptions SET SCHEMA tenant_default;
ALTER TABLE public.gateway_join_states SET SCHEMA tenant_default;
ALTER TABLE public.history_entries    SET SCHEMA tenant_default;
ALTER TABLE public.scheduled_timers   SET SCHEMA tenant_default;
ALTER TABLE public.compensation_records SET SCHEMA tenant_default;

-- Seed the default tenant so existing data has a valid tenant owner
INSERT INTO public.tenants (id, name, status)
VALUES ('default', 'Default Tenant', 'active')
ON CONFLICT (id) DO NOTHING;
