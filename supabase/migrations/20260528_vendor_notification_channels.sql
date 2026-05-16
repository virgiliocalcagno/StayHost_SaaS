-- ============================================================================
-- StayHost — Sprint 7.6: multi-canal de notificación al vendor
-- Date: 2026-05-28
--
-- Why:
--   Sprint 7 dejó notification_pref como enum 3-estado (email/whatsapp_manual/
--   both). Virgilio pidió que el host pueda elegir CUALQUIER combinación
--   de canales por vendor, no solo presets. Multi-select de checkboxes.
--
--   También preparamos el modelo para WhatsApp Business API (Meta Cloud)
--   como 4to canal cuando Virgilio termine el setup de Meta.
--
-- Canales soportados:
--   'email'              → email automático (gratis, Gmail SMTP)
--   'push'               → Web Push notification PWA (gratis, VAPID)
--   'whatsapp_manual'    → habilita botón en OrdersTab; no auto
--   'whatsapp_business'  → WhatsApp Business API (Meta Cloud, requiere setup)
-- ============================================================================

alter table public.upsell_vendors
  add column if not exists notification_channels jsonb not null default '["email","whatsapp_manual","push"]'::jsonb;

comment on column public.upsell_vendors.notification_channels is
  'Array de canales habilitados por el host para este vendor. Valores válidos: email, push, whatsapp_manual, whatsapp_business. Default: los 3 gratis.';

-- Migrar valores del notification_pref viejo:
--   'email'           → ["email","push"]
--   'whatsapp_manual' → ["whatsapp_manual","push"]
--   'both'            → ["email","whatsapp_manual","push"]
-- Push se incluye por default porque es el canal operativo principal.
update public.upsell_vendors
  set notification_channels = case
    when notification_pref = 'email' then '["email","push"]'::jsonb
    when notification_pref = 'whatsapp_manual' then '["whatsapp_manual","push"]'::jsonb
    else '["email","whatsapp_manual","push"]'::jsonb
  end
  where notification_channels = '["email","whatsapp_manual","push"]'::jsonb;

-- Dropear la columna vieja. El código siguiente usa notification_channels.
alter table public.upsell_vendors drop column if exists notification_pref;
