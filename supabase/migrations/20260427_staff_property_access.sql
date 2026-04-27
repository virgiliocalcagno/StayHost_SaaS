-- ============================================================================
-- StayHost — PIN cíclico TTLock para staff (Acceso-2)
-- Date: 2026-04-27
--
-- Cada miembro del equipo (limpiadora / mantenimiento) tiene PIN propio
-- por propiedad asignada, con ventana horaria que se repite todos los
-- días. El PIN se sube a la cerradura TTLock como código cíclico.
--
-- Modelo:
--   * staff_property_access  — la asignación staff↔propiedad↔ventana
--   * access_pins.team_member_id  — link al PIN físico en TTLock (reusa la
--     misma tabla y todo el patrón de sync/retry/reconcile que ya existe).
--   * access_pins.is_cyclic  — discrimina PIN de huésped (period) de PIN
--     de staff (cyclic).
--   * access_pins.cyclic_config  — JSONB con { weekDays:[1..7], startMin, endMin }
--
-- Idempotente.
-- ============================================================================

-- 1) Extender access_pins ─────────────────────────────────────────────
alter table public.access_pins
  add column if not exists team_member_id uuid references public.team_members(id) on delete cascade,
  add column if not exists is_cyclic boolean not null default false,
  add column if not exists cyclic_config jsonb;

-- Si es PIN cíclico de staff, valid_from/valid_to NO aplica de la misma
-- forma — los usamos como rango opcional (ej. desde hoy, sin fin). Pero
-- el constraint original `valid_to > valid_from` sigue siendo verdad
-- siempre, así que no hace falta tocarlo.
--
-- Antes booking_id era el único link; ahora puede ser team_member_id en
-- su lugar. Validamos a nivel app (la BD acepta ambos NULL para PINs
-- manuales sin reserva ni staff).

create index if not exists access_pins_team_member_idx
  on public.access_pins (team_member_id, status)
  where team_member_id is not null;

-- 2) Tabla staff_property_access ──────────────────────────────────────
create table if not exists public.staff_property_access (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  team_member_id        uuid not null references public.team_members(id) on delete cascade,
  property_id           uuid not null references public.properties(id) on delete cascade,

  -- Ventana horaria por defecto en formato "HH:MM" (ej. "09:00", "17:00").
  -- Usamos text para que sea trivial mostrar/editar en el form. La
  -- conversión a minutos-desde-medianoche para TTLock pasa en la lib.
  default_window_start  text not null default '08:00',
  default_window_end    text not null default '18:00',

  -- Días de la semana activos: 1=lunes ... 7=domingo (ISO).
  -- Default = todos los días.
  weekdays              int[] not null default array[1,2,3,4,5,6,7],

  -- FK al PIN físico en access_pins. NULL hasta que se genere.
  access_pin_id         uuid references public.access_pins(id) on delete set null,

  is_active             boolean not null default true,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Una persona NO puede tener 2 asignaciones activas a la misma propiedad
  -- (de lo contrario tendríamos 2 PINs cíclicos para el mismo staff/lock).
  constraint staff_property_access_unique
    unique (team_member_id, property_id)
);

create index if not exists staff_property_access_tenant_idx
  on public.staff_property_access (tenant_id, created_at desc);

create index if not exists staff_property_access_member_idx
  on public.staff_property_access (team_member_id, is_active);

create index if not exists staff_property_access_property_idx
  on public.staff_property_access (property_id, is_active);

drop trigger if exists staff_property_access_touch_updated_at
  on public.staff_property_access;
create trigger staff_property_access_touch_updated_at
  before update on public.staff_property_access
  for each row execute function public.touch_updated_at();

-- 3) RLS ───────────────────────────────────────────────────────────────
alter table public.staff_property_access enable row level security;

drop policy if exists staff_property_access_select_own
  on public.staff_property_access;
create policy staff_property_access_select_own
  on public.staff_property_access for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists staff_property_access_insert_own
  on public.staff_property_access;
create policy staff_property_access_insert_own
  on public.staff_property_access for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists staff_property_access_update_own
  on public.staff_property_access;
create policy staff_property_access_update_own
  on public.staff_property_access for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists staff_property_access_delete_own
  on public.staff_property_access;
create policy staff_property_access_delete_own
  on public.staff_property_access for delete to authenticated
  using (tenant_id = public.current_tenant_id());
