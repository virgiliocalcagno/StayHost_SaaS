-- ============================================================================
-- StayHost — tenants: branding y contacto público para el Hub
-- Date: 2026-04-29
--
-- Why:
--   El Settings del cliente (Sprint 6) necesita campos persistentes para que
--   el huésped vea el negocio del host y para que el host pueda personalizar
--   su Hub público:
--
--     - contact_email     : email público del host (lo ve el huésped en el hub)
--     - hub_welcome_message : texto custom de bienvenida en el hub público
--     - logo_url          : URL al logo (Storage o externo) — opcional
--
--   `company` y `owner_whatsapp` ya existen de migraciones previas. Esta
--   migración solo agrega lo que falta. Idempotente.
-- ============================================================================

alter table public.tenants
  add column if not exists contact_email text,
  add column if not exists hub_welcome_message text,
  add column if not exists logo_url text;

comment on column public.tenants.contact_email is
  'Email público del host visible en el Hub. Si NULL, se cae al email de auth.';
comment on column public.tenants.hub_welcome_message is
  'Texto de bienvenida custom mostrado en el Hub público (max ~500 char).';
comment on column public.tenants.logo_url is
  'URL del logo del host. Puede ser Storage de Supabase o URL externa.';
