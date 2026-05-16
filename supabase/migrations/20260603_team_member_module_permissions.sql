-- ============================================================================
-- StayHost — permisos por módulo en team_members
-- Date: 2026-06-03
--
-- Why:
--   Sprint 8d creó tenant_module_contacts (tabla separada de encargados por
--   módulo). Pero el sistema correcto era extender team_members con permisos
--   por módulo: el host marca qué team member atiende cada módulo (Tienda,
--   Limpieza, Check-in, Mantenimiento) y las notificaciones del módulo usan
--   su email/phone. NO duplica datos, aprovecha el sistema de roles existente.
-- ============================================================================

alter table public.team_members
  add column if not exists perm_module_shop        boolean not null default false,
  add column if not exists perm_module_cleaning    boolean not null default false,
  add column if not exists perm_module_checkin     boolean not null default false,
  add column if not exists perm_module_maintenance boolean not null default false;

comment on column public.team_members.perm_module_shop is
  'Encargado operativo del módulo Tienda/Ventas Extras. Si true, recibe notifs de vendor declines, cancelaciones, recordatorios.';
comment on column public.team_members.perm_module_cleaning is
  'Encargado operativo del módulo Limpieza. Si true, recibe notifs de validación de fotos, reportes, pagos al cleaner.';
comment on column public.team_members.perm_module_checkin is
  'Encargado operativo del módulo Check-in. Si true, recibe notifs de llegadas, OCR, problemas con keybox.';
comment on column public.team_members.perm_module_maintenance is
  'Encargado operativo del módulo Mantenimiento. Si true, recibe notifs de tickets de plomero, electricista, internet.';

-- Índices parciales — sólo indexamos las rows donde el flag está activo (el
-- caso común: la inmensa mayoría de team_members tienen el flag en false).
create index if not exists team_members_module_shop_idx
  on public.team_members (tenant_id) where perm_module_shop = true;
create index if not exists team_members_module_cleaning_idx
  on public.team_members (tenant_id) where perm_module_cleaning = true;
create index if not exists team_members_module_checkin_idx
  on public.team_members (tenant_id) where perm_module_checkin = true;
create index if not exists team_members_module_maintenance_idx
  on public.team_members (tenant_id) where perm_module_maintenance = true;
