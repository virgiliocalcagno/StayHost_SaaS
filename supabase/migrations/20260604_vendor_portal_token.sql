-- ============================================================================
-- StayHost — Vendor Portal con token permanente
-- Date: 2026-06-04
--
-- Why:
--   Hasta hoy, el vendor solo tenía portal cuando ya había una orden creada
--   (`/v/[redemption_token]`). Eso era gallina-huevo: no podía suscribirse
--   a push hasta tener una orden, no podía ver historial, no podía instalar
--   PWA antes de su primera entrega.
--
--   Ahora cada vendor tiene un `portal_token` permanente. Ese token va en
--   un magic-link permanente (`/vendor/[portal_token]`) que el host le
--   manda por email al crearlo, y el vendor lo guarda como bookmark/PWA.
--
--   El token de orden (`vendor_action_token`) y el del huésped (`redemption_token`)
--   siguen existiendo — el portal del vendor SE AUTORIZA por portal_token,
--   pero las acciones individuales sobre cada orden siguen usando esos
--   tokens fingerprints como segunda capa de validación.
-- ============================================================================

-- Agregar columna; generamos token único de 32 hex chars vía pgcrypto.
alter table public.upsell_vendors
  add column if not exists portal_token text unique;

-- Backfill: poblar todos los vendors existentes con un token random.
-- gen_random_uuid() devuelve un UUID, lo hashemos para tener 32 hex chars
-- (16 bytes) y replace los guiones.
update public.upsell_vendors
  set portal_token = encode(gen_random_bytes(16), 'hex')
  where portal_token is null;

-- A partir de ahora, default automático para nuevos rows.
alter table public.upsell_vendors
  alter column portal_token set default encode(gen_random_bytes(16), 'hex');

-- Forzar NOT NULL una vez todos los rows tienen valor.
alter table public.upsell_vendors
  alter column portal_token set not null;

-- Index para lookup rápido en /api/vendor/portal/[token].
create unique index if not exists upsell_vendors_portal_token_idx
  on public.upsell_vendors(portal_token);

comment on column public.upsell_vendors.portal_token is
  'Token permanente del vendor para auth del Vendor Portal (/vendor/[token]). 32 chars hex (16 bytes random). NO expira. NO debe loggearse en URLs públicas. Se manda por email al vendor al crearlo.';
