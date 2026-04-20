-- ============================================================================
-- StayHost — team_members: personal operativo (limpieza, co-host, admin, etc.)
-- Date: 2026-04-19
--
-- Why:
--   TeamPanel venía persistiendo en localStorage (`stayhost_team`), por lo que
--   los miembros desaparecían al cambiar de dispositivo o borrar caché. Esta
--   tabla guarda todo en Supabase con RLS por tenant.
-- ============================================================================

create table if not exists public.team_members (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  -- Identidad
  name            text not null,
  email           text not null,
  phone           text,
  avatar_url      text,

  -- Rol y permisos
  role            text not null default 'cleaner'
                  check (role in (
                    'admin','manager','cleaner','co_host','maintenance',
                    'guest_support','owner','accountant'
                  )),
  status          text not null default 'pending'
                  check (status in ('active','inactive','pending')),
  available       boolean not null default true,

  -- Datos opcionales del wizard de invitación
  document_id        text,
  emergency_phone    text,
  address            text,
  references_json    jsonb,                -- [{name, phone}, …]
  document_photo_url text,

  -- Permisos granulares (espejo del objeto `permissions` del UI)
  perm_view_analytics   boolean not null default false,
  perm_manage_tasks     boolean not null default true,
  perm_message_guests   boolean not null default false,
  perm_edit_properties  boolean not null default false,

  -- Acceso a propiedades: 'all' o lista de UUIDs en un jsonb array
  property_access jsonb not null default '"all"'::jsonb,

  -- Preferencias de notificación
  notif_whatsapp  boolean not null default true,
  notif_email     boolean not null default true,

  -- KPIs que el panel muestra. Son campos denormalizados —se recalculan
  -- a partir de cleaning_tasks cuando haga falta. Por ahora los persistimos
  -- como los maneje el UI.
  properties_count  integer not null default 0,
  tasks_completed   integer not null default 0,
  tasks_today       integer not null default 0,
  rating            numeric(3,2) not null default 0,

  -- Metadata temporal
  join_date         date not null default current_date,
  last_active_at    timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint team_members_email_per_tenant_unique unique (tenant_id, email)
);

create index if not exists team_members_tenant_idx
  on public.team_members (tenant_id, created_at desc);

create index if not exists team_members_role_idx
  on public.team_members (tenant_id, role);

drop trigger if exists team_members_touch_updated_at on public.team_members;
create trigger team_members_touch_updated_at
  before update on public.team_members
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.team_members enable row level security;

drop policy if exists team_members_select_own on public.team_members;
create policy team_members_select_own on public.team_members
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists team_members_insert_own on public.team_members;
create policy team_members_insert_own on public.team_members
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists team_members_update_own on public.team_members;
create policy team_members_update_own on public.team_members
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists team_members_delete_own on public.team_members;
create policy team_members_delete_own on public.team_members
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
