-- ============================================================================
-- StayHost — module_overrides por tenant para "plan a medida"
-- Date: 2026-04-29
--
-- Por que:
--   El plan comercial (starter / growth / master) define el set base de
--   modulos habilitados. Pero hay clientes que necesitan un modulo extra
--   sin upgradear todo el plan, o queremos esconder modulos para un
--   cliente especifico durante el rollout. Con esta columna, el Master
--   puede sobrescribir on/off por modulo desde el AdminPanel.
--
-- Forma:
--   {"upsells": true, "messages": false, ...}
--   - true  → forzar habilitado aunque el plan no lo incluya
--   - false → forzar deshabilitado aunque el plan lo incluya
--   - clave ausente → respetar el plan
-- ============================================================================

alter table public.tenants
  add column if not exists module_overrides jsonb not null default '{}'::jsonb;

-- Sanity check:
-- select email, plan, module_overrides from tenants order by created_at desc;
