-- ============================================================================
-- StayHost — Sprint 7: portal del vendor + auth por action_token
-- Date: 2026-05-26
--
-- Why:
--   Sprint 6 dejó el huésped con QR + PIN listos para mostrar. Sprint 7
--   abre el lado del vendor:
--     - Email automático al vendor cuando una orden pasa a paid
--     - Portal público /v/[redemption_token] donde el vendor ve la orden
--     - Acciones (confirmar/declinar/entregar) requieren credenciales extra
--
-- Auth model:
--   El portal /v/[token] usa redemption_token como identificador público.
--   Las ACCIONES requieren además vendor_action_token (UUID que va SOLO
--   en el email del vendor como query ?k=...). Sin esto, alguien con el
--   QR del huésped puede VER la orden pero no actuarla.
--
--   "Marcar entregada" requiere también el PIN del huésped → prueba de
--   presencia física (vendor + huésped en el mismo lugar al momento).
-- ============================================================================

-- service_orders: agregar token de gestión del vendor + timestamp del email.
alter table public.service_orders
  add column if not exists vendor_action_token   text,
  add column if not exists vendor_email_sent_at  timestamptz,
  add column if not exists vendor_declined_at    timestamptz,
  add column if not exists vendor_confirmed_at   timestamptz,
  add column if not exists vendor_decline_reason text;

comment on column public.service_orders.vendor_action_token is
  'UUID que va en el email del vendor (?k=...). Requerido para confirm/decline/deliver. NULL = no se envió email al vendor todavía.';
comment on column public.service_orders.vendor_email_sent_at is
  'Timestamp del envío del email al vendor — para evitar re-envíos al re-procesar webhooks o re-capturar.';
comment on column public.service_orders.vendor_declined_at is
  'Cuándo el vendor declinó la orden. NULL si nunca declinó.';
comment on column public.service_orders.vendor_confirmed_at is
  'Cuándo el vendor confirmó la orden (estado confirmed antes de delivered).';
comment on column public.service_orders.vendor_decline_reason is
  'Razón del decline del vendor (texto libre para que el host entienda).';

-- Unique index parcial sobre vendor_action_token para que el lookup público
-- del portal sea eficiente y rechace tokens reutilizados/inválidos.
create unique index if not exists service_orders_vendor_action_token_unique
  on public.service_orders (vendor_action_token)
  where vendor_action_token is not null;

-- upsell_vendors: preferencia de notificación.
alter table public.upsell_vendors
  add column if not exists notification_pref text not null default 'both'
    check (notification_pref in ('email', 'whatsapp_manual', 'both'));

comment on column public.upsell_vendors.notification_pref is
  'Cómo notificar al vendor de nuevas órdenes: email (auto), whatsapp_manual (el host clickea botón), o both (default).';
