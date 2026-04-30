-- ============================================================================
-- StayHost — bookings: ampliar check constraints para "solicitudes" del Hub
-- Date: 2026-04-29
--
-- Why:
--   Las reservas que llegan desde el Hub público no se confirman
--   automáticamente — son SOLICITUDES que el host aprueba o rechaza desde el
--   dashboard. Necesitamos:
--
--     - status = 'pending_review' → solicitud abierta esperando aprobación.
--                                    NO bloquea overlap (otros pueden pedir
--                                    las mismas fechas; el host elige).
--     - source = 'hub'             → distingue lo que entra desde el Hub
--                                    público de lo que carga el host
--                                    manualmente.
--
--   Anti-fraude: dos huéspedes piden las mismas fechas → ambas solicitudes
--   se crean. Al aprobar la primera, la segunda queda inválida (overlap se
--   valida en el momento de approve, no de create).
--
--   Idempotente: drop + recreate de los checks. Sumamos los nuevos valores
--   a los existentes.
-- ============================================================================

alter table public.bookings
  drop constraint if exists bookings_source_check;

alter table public.bookings
  add constraint bookings_source_check
  check (source in (
    'airbnb', 'vrbo', 'booking',
    'manual', 'direct', 'other',
    'block',
    'hub'
  ));

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in (
    'confirmed', 'pending', 'cancelled',
    'blocked',
    'pending_review'
  ));

-- Índice para que el panel "Solicitudes pendientes" sea rápido aún con
-- miles de bookings históricos. Solo indexa filas pending_review (índice
-- parcial) — barato y enfocado.
create index if not exists bookings_pending_review_idx
  on public.bookings (tenant_id, created_at desc)
  where status = 'pending_review';
