-- 2026-04-26 — Tipos de bloqueo y limpieza condicional
--
-- Hasta ahora los bloqueos eran "planos": una entrada en bookings con
-- source='block' sin metadatos. El host no podia distinguir un bloqueo
-- por mantenimiento de uno por uso personal o de una pre-reserva (hold)
-- mientras un huesped negocia. Y los bloqueos nunca generaban tareas de
-- limpieza, aunque despues de un mantenimiento o una estadia personal
-- la unidad sigue necesitando limpiarse antes del proximo huesped.
--
-- Cambios:
--   - block_type: categoriza el motivo. NULL para reservas reales y para
--     bloqueos viejos (los tratamos como "other" en la UI sin migracion
--     destructiva).
--   - requires_cleaning: si true, el cron / API genera una cleaning_task
--     el dia de check_out del bloqueo a la hora de checkout de la
--     propiedad. Defaults pensados:
--        maintenance → true  (despues de obra hay que limpiar)
--        personal    → true  (el host tambien ensucia)
--        pre_booking → true  (porque va a venir un huesped)
--        other       → host elige
--     El usuario igual puede sobrescribir el default en el form.

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS block_type text
    CHECK (block_type IS NULL OR block_type IN ('maintenance','personal','pre_booking','other')),
  ADD COLUMN IF NOT EXISTS requires_cleaning boolean NOT NULL DEFAULT false;

-- Indice parcial para que las queries del cron / API que buscan bloqueos
-- con limpieza programada no escaneen toda la tabla.
CREATE INDEX IF NOT EXISTS bookings_block_cleaning_idx
  ON public.bookings (check_out)
  WHERE source = 'block' AND requires_cleaning = true;

COMMIT;
