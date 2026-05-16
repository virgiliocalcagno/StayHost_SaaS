-- ============================================================================
-- StayHost — refund tracking en service_orders
-- Date: 2026-05-21
--
-- Why:
--   Sprint 4 cerró con un "Marcar reembolsada" que solo cambiaba estado: el
--   refund real lo hacía el host manualmente en su dashboard PayPal. Esta
--   migración agrega los campos necesarios para que el SaaS dispare el
--   refund vía API PayPal v2.
--
-- Campos:
--   payment_capture_id  → ID del capture devuelto por PayPal (separado del
--                         payment_id que hoy guarda el order ID). Necesario
--                         para llamar POST /v2/payments/captures/{id}/refund.
--   refunded_at         → cuándo se procesó el refund
--   refund_amount       → monto refundeado (puede ser parcial en v2)
--   refund_payment_id   → ID del objeto refund de PayPal (para audit/dispute)
--   refund_note         → nota del host que se mostró al huésped en el refund
--
-- Backfill: payment_capture_id queda NULL para órdenes históricas. El
-- endpoint de refund tiene fallback que consulta PayPal con el order_id
-- (que sí está en payment_id) para resolver el capture_id en vivo.
-- ============================================================================

alter table public.service_orders
  add column if not exists payment_capture_id text,
  add column if not exists refunded_at         timestamptz,
  add column if not exists refund_amount       numeric(12,2),
  add column if not exists refund_payment_id   text,
  add column if not exists refund_note         text;

-- Comentario en columnas para que sea explícito qué guarda cada cosa —
-- payment_id vs payment_capture_id se confunde fácil.
comment on column public.service_orders.payment_id is
  'PayPal: ID de la ORDER (objeto /v2/checkout/orders/{id}). Para refunds usar payment_capture_id.';
comment on column public.service_orders.payment_capture_id is
  'PayPal: ID del CAPTURE dentro de la orden. Usar en POST /v2/payments/captures/{id}/refund.';
comment on column public.service_orders.refund_payment_id is
  'PayPal: ID del objeto REFUND devuelto al procesar la devolución.';
