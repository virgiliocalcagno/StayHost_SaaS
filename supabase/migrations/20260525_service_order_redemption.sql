-- ============================================================================
-- StayHost — redención de service orders: QR + PIN + estado del vendor
-- Date: 2026-05-25
--
-- Why:
--   Hasta ahora el huésped pagaba y se enteraba "por email" — el vendor
--   no recibía nada automático y no había forma de validar la entrega en
--   el lugar. Esta migración prepara el modelo para:
--     - QR + PIN único por orden (huésped los muestra al vendor)
--     - Vendor escanea o tipea → marca "entregada"
--     - Estado del vendor separado del estado de pago/order
--
-- El portal del vendor + email automático llegan en sprints siguientes.
-- Esta migración solo prepara la BD y los identificadores.
--
-- Identificadores:
--   redemption_token TEXT → 32-char UUID hex, va dentro del QR como query.
--                           NUNCA se muestra al huésped tipeado (es largo).
--   redemption_pin   TEXT → 6 chars uppercase, alfabeto SAFE (sin 0/O/1/I/L).
--                           Es el fallback si el QR falla (sol fuerte,
--                           celular descargado, vendor sin cámara).
-- ============================================================================

alter table public.service_orders
  add column if not exists redemption_token       text,
  add column if not exists redemption_pin         text,
  add column if not exists redeemed_at            timestamptz,
  add column if not exists redeemed_by_vendor_id  uuid references public.upsell_vendors(id) on delete set null,
  add column if not exists vendor_status          text not null default 'awaiting'
    check (vendor_status in ('awaiting','confirmed','declined','delivered','no_show'));

comment on column public.service_orders.redemption_token is
  '32-char hex UUID que va dentro del QR del huésped. Único, no-adivinable. Se valida en el endpoint del vendor al escanear/redimir.';
comment on column public.service_orders.redemption_pin is
  '6-char alfabeto SAFE (sin 0/O/1/I/L) que el huésped puede dictar al vendor si el QR falla. Misma capacidad de redención que el token.';
comment on column public.service_orders.redeemed_at is
  'Timestamp de cuando el vendor marcó la orden como entregada vía QR/PIN.';
comment on column public.service_orders.redeemed_by_vendor_id is
  'Qué vendor redimió la orden. SET NULL si el vendor se elimina (no perdemos historial de la redención).';
comment on column public.service_orders.vendor_status is
  'Estado del lado del vendor, separado del estado de pago. awaiting (recién pagada, esperando vendor) → confirmed (vendor aceptó) | declined (vendor rechazó) → delivered (entregada) | no_show (huésped no apareció).';

-- Índice único parcial sobre el token. NULL permitido (órdenes históricas
-- antes del fix) pero cuando hay valor, debe ser único globalmente —
-- evita colisiones cross-tenant que permitan que un vendor de host A
-- "redima" la orden de host B si adivinara el token (improbable pero
-- la unicidad nos cubre).
create unique index if not exists service_orders_redemption_token_unique
  on public.service_orders (redemption_token)
  where redemption_token is not null;

-- Backfill: las órdenes existentes que ya están paid/completed no tienen
-- redemption_token. Las dejamos NULL — esas no se pueden redimir vía QR,
-- el host las marca a mano como hasta ahora. Para nuevas órdenes, el
-- endpoint POST /service-order genera el token al crear.
