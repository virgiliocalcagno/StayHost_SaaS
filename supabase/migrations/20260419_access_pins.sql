-- ============================================================================
-- StayHost — access_pins: códigos de acceso (TTLock / manuales) por propiedad
-- Date: 2026-04-19
--
-- Why:
--   El panel de "Llaves & PINs" venía leyendo/escribiendo en localStorage,
--   lo que:
--     1. No persistía entre dispositivos ni sesiones.
--     2. No permitía que el servidor conozca los códigos activos para
--        sincronizar/invalidar cuando llega un webhook de TTLock.
--     3. No tenía relación real con las reservas ni con la cerradura.
--
--   Este archivo crea la tabla `access_pins` con scoping por tenant y las
--   relaciones mínimas: propiedad, cerradura TTLock (opcional) y reserva
--   (opcional, para PINs auto-generados desde iCal).
-- ============================================================================

create table if not exists public.access_pins (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  booking_id     uuid references public.bookings(id) on delete set null,

  -- La cerradura a la que pertenece el código. Puede ser NULL si es un PIN
  -- virtual (no grabado aún en la cerradura). Para TTLock guardamos el
  -- lockId como texto porque algunas migraciones viejas lo traen como bigint.
  ttlock_lock_id text,
  ttlock_pwd_id  text,               -- keyboardPwdId devuelto por TTLock

  guest_name     text not null,
  guest_phone    text,
  pin            text not null,       -- 4-8 dígitos
  source         text not null default 'manual'
                 check (source in ('manual', 'airbnb_ical', 'vrbo_ical', 'direct_booking')),
  status         text not null default 'active'
                 check (status in ('active', 'expired', 'revoked')),

  -- Ventana de validez en ISO timestamptz. Check-in/out conventional hours
  -- se calculan en el cliente/servidor antes de insertar.
  valid_from     timestamptz not null,
  valid_to       timestamptz not null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint access_pins_dates_chk check (valid_to > valid_from)
);

create index if not exists access_pins_tenant_idx
  on public.access_pins (tenant_id, created_at desc);

create index if not exists access_pins_property_idx
  on public.access_pins (property_id, status);

create index if not exists access_pins_booking_idx
  on public.access_pins (booking_id)
  where booking_id is not null;

-- Touch updated_at automatically. Reuses the shared helper.
drop trigger if exists access_pins_touch_updated_at on public.access_pins;
create trigger access_pins_touch_updated_at
  before update on public.access_pins
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.access_pins enable row level security;

drop policy if exists access_pins_select_own on public.access_pins;
create policy access_pins_select_own on public.access_pins
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists access_pins_insert_own on public.access_pins;
create policy access_pins_insert_own on public.access_pins
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists access_pins_update_own on public.access_pins;
create policy access_pins_update_own on public.access_pins
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists access_pins_delete_own on public.access_pins;
create policy access_pins_delete_own on public.access_pins
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
