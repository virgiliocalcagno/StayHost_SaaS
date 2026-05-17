-- ============================================================================
-- Tracking de "última vez que se reenvió el receipt al huésped" para
-- prevenir que un host pícaro le mande spam al huésped clickeando 50 veces
-- el botón "Reenviar email". Cooldown de 60s entre reenvíos.
-- ============================================================================

alter table public.service_orders
  add column if not exists receipt_last_resent_at timestamptz;

comment on column public.service_orders.receipt_last_resent_at is
  'Timestamp del último reenvío manual del receipt email al huésped. Usado por /api/service-orders/[id]/resend-receipt para hacer cooldown de 60s.';
