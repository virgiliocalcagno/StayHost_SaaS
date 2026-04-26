-- 2026-04-26 — Limpieza retroactiva de cleaning_tasks huerfanas
--
-- Contexto: hasta hoy, cuando se cancelaba (status=cancelled) o eliminaba
-- (DELETE manual / orphan iCal) una reserva, la cleaning_task asociada
-- quedaba colgada en el panel de Limpiezas con booking_id apuntando a una
-- reserva inexistente o cancelada. La limpiadora seguia viendo la tarea
-- pendiente aunque ya no haya huesped.
--
-- El fix de codigo (cascadeCancelBooking) cubre las cancelaciones futuras.
-- Esta migration limpia las huerfanas que ya estan en la BD.
--
-- Politica: solo borramos tareas NO completed. Las completed se mantienen
-- como historial de limpiezas que efectivamente se hicieron.

BEGIN;

-- 1) Tareas asociadas a reservas marcadas como cancelled.
DELETE FROM public.cleaning_tasks ct
USING public.bookings b
WHERE ct.booking_id = b.id
  AND b.status = 'cancelled'
  AND ct.status <> 'completed';

-- 2) Tareas asociadas a reservas que ya no existen (DELETE manual previo).
DELETE FROM public.cleaning_tasks
WHERE booking_id IS NOT NULL
  AND status <> 'completed'
  AND booking_id NOT IN (SELECT id FROM public.bookings);

-- 3) Tareas asociadas a bloqueos (source='block') — nunca deberian haber
-- existido pero por las dudas. Los bloqueos no generan limpieza.
DELETE FROM public.cleaning_tasks ct
USING public.bookings b
WHERE ct.booking_id = b.id
  AND b.source = 'block';

COMMIT;
