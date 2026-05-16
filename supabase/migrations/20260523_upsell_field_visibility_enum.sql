-- ============================================================================
-- StayHost — info del servicio: bool requires_* → enum *_field 3-estados
-- Date: 2026-05-23
--
-- Why:
--   Sprint 5 v1 trató los flags como booleanos: marcado = obligatorio,
--   sin marcar = no se muestra. Eso bloqueaba casos legítimos como un
--   "transporte local" donde el huésped no tiene número de vuelo: el
--   producto pedía vuelo obligatorio y no podía completarse la compra.
--
--   Modelo nuevo: cada campo tiene 3 estados que el host elige:
--     'off'      → no se muestra al huésped
--     'optional' → se muestra como opcional (no bloquea checkout)
--     'required' → se muestra como obligatorio (bloquea checkout si vacío)
--
--   notes_placeholder se queda igual (string null/no-null). Las notas
--   son siempre opcionales por naturaleza.
--
-- Migración value-preserving: requires_X=true → X_field='required',
-- requires_X=false → X_field='off'. Luego matizamos templates con
-- 'optional' donde aplica (lavandería, welcome basket, late checkout).
-- ============================================================================

-- 1) Agregar nuevas columnas enum (text + CHECK).
alter table public.upsells
  add column if not exists time_field   text not null default 'off'
    check (time_field   in ('off','optional','required')),
  add column if not exists pickup_field text not null default 'off'
    check (pickup_field in ('off','optional','required')),
  add column if not exists flight_field text not null default 'off'
    check (flight_field in ('off','optional','required'));

alter table public.upsell_templates
  add column if not exists time_field   text not null default 'off'
    check (time_field   in ('off','optional','required')),
  add column if not exists pickup_field text not null default 'off'
    check (pickup_field in ('off','optional','required')),
  add column if not exists flight_field text not null default 'off'
    check (flight_field in ('off','optional','required'));

-- 2) Migrar valores existentes de los bools a los enums.
update public.upsells set
  time_field   = case when requires_time            then 'required' else 'off' end,
  pickup_field = case when requires_pickup_location then 'required' else 'off' end,
  flight_field = case when requires_flight_number   then 'required' else 'off' end;

update public.upsell_templates set
  time_field   = case when requires_time            then 'required' else 'off' end,
  pickup_field = case when requires_pickup_location then 'required' else 'off' end,
  flight_field = case when requires_flight_number   then 'required' else 'off' end;

-- 3) Matizar templates Punta Cana con defaults más realistas:
--    - Shuttle aeropuerto: pickup OFF (el huésped no elige pickup, sale del gate)
--    - Lavandería / late check-out / welcome basket / mid-stay: time OPTIONAL
--      (estos servicios son flexibles, el host coordina sin hora rígida)
update public.upsell_templates set pickup_field = 'off'
  where market = 'punta-cana' and name = 'Shuttle Aeropuerto PUJ';

update public.upsell_templates set time_field = 'optional'
  where market = 'punta-cana' and name in (
    'Lavandería express',
    'Late check-out (4 hs)',
    'Welcome basket',
    'Limpieza mid-stay'
  );

-- 4) Dropear los bools viejos. Quedan deprecated pero sin tocar — borrarlos
--    ahora evita ambigüedad en el código que lea ambos.
alter table public.upsells
  drop column if exists requires_time,
  drop column if exists requires_pickup_location,
  drop column if exists requires_flight_number;

alter table public.upsell_templates
  drop column if exists requires_time,
  drop column if exists requires_pickup_location,
  drop column if exists requires_flight_number;
