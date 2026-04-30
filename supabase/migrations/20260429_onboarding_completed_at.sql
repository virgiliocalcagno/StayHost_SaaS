-- ============================================================================
-- StayHost — flag de onboarding completado
-- Date: 2026-04-29
--
-- Por que:
--   El wizard /onboarding existe pero ningun user nuevo lo ve. El register
--   ahora redirige ahi; falta cubrir a los que entran por email confirm
--   directamente al /dashboard. Ahora /api/me devuelve onboarded:false y
--   el dashboard hace redirect.
--
-- Backfill: tenants con properties existentes se marcan como completados —
-- ya estan operativos, no tiene sentido obligarlos al wizard.
-- ============================================================================

alter table public.tenants
  add column if not exists onboarding_completed_at timestamptz;

-- Backfill: tenants que ya tienen al menos una property se consideran
-- onboardeados — estan trabajando con el sistema.
update public.tenants t
set onboarding_completed_at = now()
where t.onboarding_completed_at is null
  and exists (select 1 from public.properties p where p.tenant_id = t.id);

-- Sanity check:
-- select id, email, onboarding_completed_at,
--        (select count(*) from properties where tenant_id = tenants.id) as props
-- from tenants order by created_at desc;
