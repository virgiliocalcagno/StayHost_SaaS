-- ============================================================================
-- StayHost — fix check constraints en tenants para incluir 'trial'
-- Date: 2026-04-29
--
-- Por que:
--   La migracion 20260419_tenants_saas_fields.sql definio los checks con
--   'trial' en la lista permitida, pero usaba `add column if not exists`.
--   En BDs donde la columna ya existia (creada en una version vieja sin
--   'trial' en el check), Postgres salteo la columna entera incluyendo el
--   check. Resultado: BD activa con plan_check que NO permite 'trial', lo
--   que rompe el trigger de signup nuevo y los UPDATEs manuales.
--
-- Que hace:
--   Drop + recreate de los dos checks (plan, status) con la lista correcta.
-- ============================================================================

alter table public.tenants drop constraint if exists tenants_plan_check;
alter table public.tenants
  add constraint tenants_plan_check
  check (plan in ('trial', 'starter', 'growth', 'master'));

alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants
  add constraint tenants_status_check
  check (status in ('active', 'trial', 'suspended', 'churned'));
