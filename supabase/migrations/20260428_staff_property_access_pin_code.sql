-- ============================================================================
-- StayHost — staff_property_access: PIN fijo activado por tarea
-- Date: 2026-04-28
--
-- Cambio de modelo: el PIN cíclico (todos los días en una ventana) era
-- demasiado permisivo — la limpiadora solo debe poder abrir cuando tiene
-- una tarea asignada en esa propiedad.
--
-- Nueva semántica:
--   * pin_code (NEW, requerido): el código fijo de la persona en esa
--     propiedad. Igual número siempre — fácil de recordar para la limpiadora.
--   * El PIN se sube a la cerradura SOLO al asignar una tarea de limpieza
--     en esa propiedad, válido 8am-6pm del día de la tarea (ventana global).
--   * Al completar/cancelar la tarea, el PIN se revoca.
--
-- Las columnas viejas (default_window_start/end, weekdays, access_pin_id)
-- quedan por compatibilidad pero ya no se usan. Se pueden borrar después.
--
-- Idempotente.
-- ============================================================================

alter table public.staff_property_access
  add column if not exists pin_code text;

-- Backfill: si alguna fila tiene access_pin_id, copiar su pin como pin_code.
update public.staff_property_access spa
set pin_code = ap.pin
from public.access_pins ap
where spa.access_pin_id = ap.id
  and spa.pin_code is null;

-- Una vez backfilleado, lo hacemos NOT NULL para asignaciones nuevas.
-- Si quedaron filas sin pin_code (ej: asignación sin access_pin), las
-- limpiamos primero asignando un PIN aleatorio para no fallar la migración.
update public.staff_property_access
set pin_code = lpad((100000 + floor(random() * 900000))::int::text, 6, '0')
where pin_code is null;

alter table public.staff_property_access
  alter column pin_code set not null;

-- Cleanup de PINs cíclicos huérfanos: marcar como revoked todos los
-- access_pins is_cyclic=true del tenant. La nueva lógica los regenera
-- on-demand al asignar tarea, no necesitamos los cíclicos viejos.
update public.access_pins
set status = 'revoked'
where is_cyclic = true
  and status = 'active';
