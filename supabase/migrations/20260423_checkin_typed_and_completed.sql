-- ============================================================================
-- StayHost — checkin_records: campos tipeados por el huesped + completacion
-- Date: 2026-04-23
--
-- Issue: la UI del Paso 2 solo mostraba los datos del OCR como read-only.
-- Si el OCR falla o extrae mal el nombre/nacionalidad/documento, el huesped
-- no tiene forma de corregirlo ni de cargarlo a mano. Ademas, el checkin no
-- tenia un timestamp de "terminado", por lo que si el huesped reabria el
-- link, el flujo volvia a empezar desde el Paso 2.
--
-- Solucion:
--   1) guest_typed_* → campos tipeados por el huesped, editables siempre,
--      prellenados con OCR cuando exista (audit trail: queda el OCR crudo y
--      lo que tipeo el huesped, para comparar).
--   2) checkin_completed_at → timestamp de cuando el huesped llego al
--      "acceso liberado" (step 5 sin waiting_for_auth). Si ya esta seteado,
--      la UI salta directo al Guest Hub.
--
-- Idempotente.
-- ============================================================================

alter table public.checkin_records
  add column if not exists guest_typed_name text,
  add column if not exists guest_typed_document text,
  add column if not exists guest_typed_nationality text,
  add column if not exists checkin_completed_at timestamptz;

create index if not exists checkin_records_completed_idx
  on public.checkin_records (tenant_id, checkin_completed_at desc)
  where checkin_completed_at is not null;
