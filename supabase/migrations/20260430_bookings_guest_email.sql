-- ============================================================================
-- StayHost — capturar email del huésped en bookings
-- Date: 2026-04-30
--
-- Why:
--   Hasta ahora el email del huésped iba colado en `note` (texto libre),
--   lo cual era irrelevante mientras no mandábamos emails transaccionales.
--   Con la confirmación post-pago (Resend) necesitamos columna dedicada
--   para enviarle el recibo + datos de check-in al huésped.
--
--   Nullable: las reservas legacy de iCal/Channex no tienen email del
--   huésped y siguen siendo válidas.
-- ============================================================================

alter table public.bookings
  add column if not exists guest_email text;

comment on column public.bookings.guest_email is
  'Email del huésped para envío de confirmaciones post-pago. NULL en bookings que vienen de iCal/Channex/Airbnb donde no tenemos el email.';
