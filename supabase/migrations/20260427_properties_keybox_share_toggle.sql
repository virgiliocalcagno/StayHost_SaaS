-- ============================================================================
-- StayHost — toggle "compartir caja con huésped"
-- Date: 2026-04-27
--
-- Caso real: una propiedad puede tener cerradura inteligente (TTLock) Y
-- también una caja física. La caja a veces es solo de respaldo para el
-- equipo de limpieza/mantenimiento y NO debe compartirse con el huésped
-- (que entra con su PIN del TTLock).
--
-- Por defecto la caja se comparte con el huésped (caso más común: la caja
-- es el método principal). El host puede desactivar el toggle por
-- propiedad cuando la caja es solo para staff.
--
-- Idempotente.
-- ============================================================================

alter table public.properties
  add column if not exists keybox_share_with_guest boolean not null default true;
