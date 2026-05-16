-- ============================================================================
-- StayHost — Sprint 8b: cancelación del huésped con reglas + SLA
-- Date: 2026-05-31
--
-- Reglas de cancelación (decididas con Virgilio):
--   1) Si vendor_status='delivered' → BLOQUEADA (servicio ya entregado).
--   2) Si vendor_status='cancelled' o refunded_at != null → BLOQUEADA (ya canceló).
--   3) Si now < service_date - cutoff_hours Y vendor_status != 'confirmed':
--        → cliente cancela SOLO, refund automático PayPal, sin pedir permiso.
--   4) Si pasó cutoff o vendor_status='confirmed':
--        → cliente solicita, host aprueba/rechaza desde OrdersTab.
--        → SLA 24h: si host no responde, cron auto-aprueba con refund.
--
-- Columnas nuevas track el flow completo + permite UI de "pending":
-- ============================================================================

alter table public.service_orders
  add column if not exists cancellation_requested_at  timestamptz,
  add column if not exists cancellation_requested_by  text
    check (cancellation_requested_by is null
           or cancellation_requested_by in ('guest','host','vendor','system_sla')),
  add column if not exists cancellation_reason        text,
  add column if not exists cancellation_decided_at    timestamptz,
  add column if not exists cancellation_decision      text
    check (cancellation_decision is null
           or cancellation_decision in ('approved','rejected')),
  add column if not exists cancellation_decided_by    text
    check (cancellation_decided_by is null
           or cancellation_decided_by in ('host','system_sla','guest_self'));

comment on column public.service_orders.cancellation_requested_at is
  'Cuándo se solicitó la cancelación. NULL = no se solicitó.';
comment on column public.service_orders.cancellation_requested_by is
  'Quién la solicitó: guest (cliente), host (admin del host), vendor (declinó), system_sla (auto).';
comment on column public.service_orders.cancellation_reason is
  'Motivo libre del solicitante. Max ~500 chars.';
comment on column public.service_orders.cancellation_decided_at is
  'Timestamp de la decisión final.';
comment on column public.service_orders.cancellation_decision is
  'approved → refund + status=cancelled; rejected → vuelve a estado anterior.';
comment on column public.service_orders.cancellation_decided_by is
  'host = manual; system_sla = auto-aprobada por timeout; guest_self = cancelación instantánea pre-cutoff.';

-- Index para el cron SLA: buscar requests sin decisión > 24h.
create index if not exists service_orders_cancellation_pending_idx
  on public.service_orders (cancellation_requested_at)
  where cancellation_decided_at is null and cancellation_requested_at is not null;
