-- ============================================================================
-- StayHost — bookings: documento + nacionalidad (del OCR del dashboard)
-- Date: 2026-04-22
--
-- Cuando el host escanea el documento al crear una reserva directa
-- (DocumentScanButton en MultiCalendar), el frontend ya esta enviando
-- guestDoc y guestNationality pero no habia columnas en bookings.
--
-- Estas columnas se usan para dos cosas:
--  1. Auto-completar los campos OCR del checkin_record cuando el huesped
--     entra al check-in (flujo adaptativo — no volver a pedir lo que el
--     host ya cargo)
--  2. Referencia futura para cumplimiento regulatorio
-- ============================================================================

alter table public.bookings
  add column if not exists guest_doc text,
  add column if not exists guest_nationality text;
