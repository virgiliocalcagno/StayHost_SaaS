-- ============================================================================
-- StayHost — pagos: comisión de procesamiento configurable por host
-- Date: 2026-04-29
--
-- Why:
--   PayPal cobra al host fees variables (3.49% + $0.49 USA doméstico, ~5.4% +
--   fee fijo cross-border LATAM, hasta 5.9% en algunos países). Para no comer
--   margen, el host puede pasar la comisión al huésped como una línea separada
--   en el desglose ("Comisión de procesamiento (5.5%) → $X").
--
--   Es opcional — si processing_fee_percent es 0, no se cobra nada extra.
--
-- Default 5.5: cubre el cross-border LATAM típico sin pasarse.
-- ============================================================================

alter table public.tenant_payment_configs
  add column if not exists processing_fee_percent numeric(5,2) not null default 5.50
    check (processing_fee_percent >= 0 and processing_fee_percent <= 20);

comment on column public.tenant_payment_configs.processing_fee_percent is
  'Comisión que el host pasa al huésped al pagar online (default 5.5% para cross-border LATAM). 0 = absorbida por el host.';

-- ── bookings: tracking del método de pago elegido ─────────────────────────
-- payment_method nos dice cómo pagó el huésped:
--   'paypal'   → pagó online via PayPal (Smart Buttons / Guest Checkout)
--   'manual'   → host coordina cobro fuera del sistema (efectivo, transfer)
--   NULL       → todavía no decidió / legacy
alter table public.bookings
  add column if not exists payment_method text
    check (payment_method in ('paypal', 'manual'));

comment on column public.bookings.payment_method is
  'Cómo pagó (o pagará) el huésped. paypal = online, manual = host coordina por fuera.';
