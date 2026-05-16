-- ============================================================================
-- StayHost — Sprint 8c: contacto operativo de la tienda separado del owner
-- Date: 2026-06-01
--
-- Why:
--   El cliente del SaaS (owner del tenant) puede ser Carlos. Pero quien
--   atiende la tienda de día a día puede ser María (encargada). Hoy todas
--   las notificaciones del módulo Ventas Extras (vendor decline, refund,
--   cancelaciones, recordatorios) van a Carlos vía tenant.contact_email y
--   tenant.owner_whatsapp. Eso satura al CEO con cosas operativas que no le
--   tocan.
--
--   Agregamos 3 campos opcionales que separan el contacto operativo:
--     shop_contact_name    → nombre del encargado (UI: para mostrar en el portal)
--     shop_contact_email   → todas las notifs del módulo van acá si existe
--     shop_contact_whatsapp → botón "Hablanos por WhatsApp" del hub público
--
--   Fallback graceful: si están NULL, todo sigue cayendo al owner como hoy.
--   Cero regresión para hosts ya configurados.
-- ============================================================================

alter table public.tenants
  add column if not exists shop_contact_name     text,
  add column if not exists shop_contact_email    text,
  add column if not exists shop_contact_whatsapp text;

comment on column public.tenants.shop_contact_name is
  'Nombre del encargado operativo de la tienda. Visible al huésped en el portal cuando aplica.';
comment on column public.tenants.shop_contact_email is
  'Email a donde caen las notifs del módulo Ventas Extras (vendor decline, cancelaciones, recordatorios). NULL → fallback a contact_email/email del owner.';
comment on column public.tenants.shop_contact_whatsapp is
  'WhatsApp operativo de la tienda. Lo abre el huésped desde el botón del hub público. NULL → fallback a owner_whatsapp.';
