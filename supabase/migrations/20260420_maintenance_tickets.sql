-- ============================================================================
-- StayHost — maintenance_tickets: tickets de mantenimiento separados de limpieza
-- Date: 2026-04-20
--
-- Why:
--   Hasta ahora los daños/problemas detectados por los limpiadores se
--   reportaban como texto libre en el campo `notes` del wizard de limpieza,
--   mezclados con la operación de cleaning. Esto tenía 3 problemas:
--     1. Un daño físico bloqueaba mentalmente el cierre de la tarea.
--     2. El admin no tenía un inbox único de mantenimiento pendiente.
--     3. No se podía asignar a un técnico distinto del limpiador.
--
--   Esta tabla desacopla mantenimiento como módulo propio con su propio
--   ciclo de vida (open → in_progress → resolved / dismissed) y puede
--   originarse desde una tarea de limpieza (cleaning_task_id) o crearse
--   manualmente desde el panel admin.
-- ============================================================================

create table if not exists public.maintenance_tickets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  property_id       uuid not null references public.properties(id) on delete cascade,

  -- Origen opcional: si el ticket nació en un wizard de limpieza, guardamos
  -- el cleaning_task_id. No hay FK física para no acoplar la migración a
  -- cleaning_tasks (que ya existe en prod pero sin migración de creación).
  cleaning_task_id  uuid,
  booking_id        uuid references public.bookings(id) on delete set null,

  -- Quién reportó. Guardamos id + nombre + avatar desnormalizado para que
  -- la UI no tenga que hacer joins con team_members (tabla que vive en otra
  -- rama y no siempre está presente).
  reported_by_id    uuid,
  reported_by_name  text,
  reported_by_avatar text,

  title             text not null,
  description       text,
  category          text not null default 'other'
                    check (category in (
                      'plumbing',       -- plomería
                      'electrical',     -- electricidad
                      'appliance',      -- electrodomésticos
                      'furniture',      -- mobiliario
                      'structural',     -- obra / estructura
                      'cleaning_supply',-- falta de insumo
                      'other'
                    )),
  severity          text not null default 'medium'
                    check (severity in ('low', 'medium', 'high', 'critical')),
  status            text not null default 'open'
                    check (status in ('open', 'in_progress', 'resolved', 'dismissed')),

  -- Evidencia opcional. Array de URLs (las imágenes viven en Supabase Storage
  -- o en el CDN usado por el wizard). Se guarda como jsonb por consistencia
  -- con closure_photos de cleaning_tasks.
  photos            jsonb not null default '[]'::jsonb,

  -- A quién se le asignó para resolver (otro team_member, técnico externo,
  -- etc.). Igual que reported_by, desnormalizado.
  assignee_id       uuid,
  assignee_name     text,

  resolution_notes  text,
  resolved_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists maintenance_tickets_tenant_idx
  on public.maintenance_tickets (tenant_id, created_at desc);

create index if not exists maintenance_tickets_property_idx
  on public.maintenance_tickets (property_id, status);

create index if not exists maintenance_tickets_status_idx
  on public.maintenance_tickets (tenant_id, status)
  where status in ('open', 'in_progress');

create index if not exists maintenance_tickets_cleaning_task_idx
  on public.maintenance_tickets (cleaning_task_id)
  where cleaning_task_id is not null;

-- Touch updated_at automatically. Reuses the shared helper if available; if
-- the helper doesn't exist in this environment, create a local copy.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'touch_updated_at'
  ) then
    create or replace function public.touch_updated_at()
    returns trigger language plpgsql as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end $$;

drop trigger if exists maintenance_tickets_touch_updated_at on public.maintenance_tickets;
create trigger maintenance_tickets_touch_updated_at
  before update on public.maintenance_tickets
  for each row execute function public.touch_updated_at();

-- Cuando un ticket pasa a resolved, marcar resolved_at automáticamente
-- (solo si no viene explícito). Mantiene la columna consistente sin que la
-- API tenga que recordarlo.
create or replace function public.maintenance_tickets_set_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' and new.resolved_at is null then
    new.resolved_at = now();
  elsif new.status <> 'resolved' then
    new.resolved_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_tickets_resolved_at on public.maintenance_tickets;
create trigger maintenance_tickets_resolved_at
  before update on public.maintenance_tickets
  for each row execute function public.maintenance_tickets_set_resolved_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.maintenance_tickets enable row level security;

drop policy if exists maintenance_tickets_select_own on public.maintenance_tickets;
create policy maintenance_tickets_select_own on public.maintenance_tickets
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists maintenance_tickets_insert_own on public.maintenance_tickets;
create policy maintenance_tickets_insert_own on public.maintenance_tickets
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists maintenance_tickets_update_own on public.maintenance_tickets;
create policy maintenance_tickets_update_own on public.maintenance_tickets
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists maintenance_tickets_delete_own on public.maintenance_tickets;
create policy maintenance_tickets_delete_own on public.maintenance_tickets
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
