-- ============================================================================
-- StayHost — bookings: ampliar check constraints para soportar bloqueos
-- Date: 2026-04-21
--
-- Why:
--   /api/ical/import insertaba VEVENTs tipo "Airbnb (Not available)" con
--   source = 'block' y status = 'blocked', pero el check constraint original
--   de la tabla no aceptaba esos valores. El upsert fallaba con
--   "violates check constraint bookings_source_check" y los bloqueos manuales
--   hechos en Airbnb seguian apareciendo libres en StayHost — riesgo real
--   de overbooking.
--
--   El UI del MultiCalendarPanel ("Agregar Bloqueo") tambien depende de
--   poder insertar source = 'block', asi que este fix tambien desbloquea
--   esa funcionalidad.
-- ============================================================================

alter table public.bookings
  drop constraint if exists bookings_source_check;

alter table public.bookings
  add constraint bookings_source_check
  check (source in (
    'airbnb', 'vrbo', 'booking',
    'manual', 'direct', 'other',
    'block'
  ));

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in (
    'confirmed', 'pending', 'cancelled',
    'blocked'
  ));
