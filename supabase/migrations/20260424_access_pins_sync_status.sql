-- ============================================================================
-- StayHost — access_pins: estado de sincronizacion a TTLock
-- Date: 2026-04-24
--
-- Why:
--   Hasta hoy el host tenia que apretar un boton "Sincronizar" para que el
--   PIN fuera a la cerradura, y el sync no borraba el PIN viejo — TTLock
--   rechazaba el alta. Resultado: huespedes se quedaban afuera de la casa
--   con el PIN "correcto" en pantalla pero mal en la cerradura.
--
--   Este cambio introduce un pipeline de auto-sync con estados y retries:
--   - pending      → creado/editado, espera primer intento
--   - syncing      → intento en curso
--   - synced       → confirmado en cerradura, ttlock_pwd_id actualizado
--   - retry        → fallo transitorio, re-intenta con backoff
--   - failed       → agoto 5 intentos, alerta al host
--   - offline_lock → la cerradura reporta offline, espera hasta 6h
--
-- Idempotente.
-- ============================================================================

alter table public.access_pins
  add column if not exists sync_status text not null default 'pending'
    check (sync_status in ('pending','syncing','synced','retry','failed','offline_lock')),
  add column if not exists sync_attempts int not null default 0,
  add column if not exists sync_last_error text,
  add column if not exists sync_next_retry_at timestamptz,
  add column if not exists sync_last_attempt_at timestamptz;

-- Indice parcial para que el worker de retry encuentre rapido las filas
-- pendientes sin escanear toda la tabla.
create index if not exists access_pins_sync_pending_idx
  on public.access_pins (sync_next_retry_at nulls first)
  where sync_status in ('pending', 'retry', 'offline_lock');

comment on column public.access_pins.sync_status is
  'Estado del sync con TTLock. Cambios al pin o al ttlock_pwd_id deben setear este campo a pending para que el worker reintente.';
