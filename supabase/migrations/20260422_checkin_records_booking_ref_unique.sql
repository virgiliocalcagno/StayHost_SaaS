-- ============================================================================
-- StayHost — UNIQUE constraint en checkin_records.booking_ref
-- Date: 2026-04-22
--
-- Causa raiz de los duplicados reportados 2026-04-22: el cliente del
-- CheckInsPanel genera un `id` nuevo cada vez que corre autoSync
-- (ci-${timestamp}-${random}). El backend hacia upsert con
-- `onConflict: id`, pero como id cambia entre corridas, el mismo booking
-- terminaba creando records duplicados.
--
-- Este constraint garantiza a nivel BD que no puede haber 2 checkin_records
-- para el mismo booking_ref. El upsertBatch ahora usa `onConflict: booking_ref`.
--
-- Antes de correr: asegurarse de haber deduplicado los records existentes
-- con el DELETE de la sesion 2026-04-22.
-- ============================================================================

alter table public.checkin_records
  add constraint checkin_records_booking_ref_unique unique (booking_ref);
