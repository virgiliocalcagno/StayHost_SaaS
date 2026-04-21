-- ============================================================================
-- StayHost — bookings: channel_code + phone_last4 para check-in self-service
-- Date: 2026-04-21
--
-- Why:
--   El check-in v2 deja de usar un link único por reserva (fragil y dificil
--   de compartir por WhatsApp) y pasa a una URL genérica "stayhost.app/checkin"
--   donde el huésped se identifica con:
--     1. Código de reserva (que recibe en su email/app del canal)
--     2. Últimos 4 dígitos del teléfono
--
--   Para que el lookup sea rápido necesitamos ambos campos indexados en la
--   tabla bookings. El parser de iCal de Airbnb ya captura ambos datos
--   (HMXXXXXXXX en DESCRIPTION + "Phone Number (Last 4 Digits)"), esta
--   migración sólo crea el schema y hace backfill.
-- ============================================================================

-- Columnas nuevas
alter table public.bookings
  add column if not exists channel_code text,       -- ej. HMNFA2954Y (Airbnb), D-A1B2C3D4 (directa)
  add column if not exists phone_last4  text;       -- ej. 7220

-- Índice para lookup ANÓNIMO — el huésped NO tiene sesión, así que el API
-- corre con service_role y busca globalmente por (código + últimos 4 tel).
-- El código Airbnb HMXXXXXXXX es único globalmente; para reservas directas
-- generamos un random suficientemente largo para que colisión sea ~0.
-- Agregar phone_last4 al índice garantiza que el index-only scan resuelve
-- el query sin ir a la tabla.
create index if not exists bookings_guest_lookup_idx
  on public.bookings (upper(channel_code), phone_last4)
  where channel_code is not null;

-- Índice por tenant para queries del admin (listado, filtros).
create index if not exists bookings_tenant_channel_code_idx
  on public.bookings (tenant_id, upper(channel_code))
  where channel_code is not null;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 1) channel_code desde booking_url (Airbnb format)
update public.bookings
set channel_code = upper(substring(booking_url from 'details/([A-Z0-9]{8,})'))
where channel_code is null
  and booking_url is not null
  and booking_url ~* 'airbnb\.[a-z.]+/.*/details/[A-Z0-9]{8,}';

-- 2) phone_last4 desde guest_phone
--    Formato 1: "****7220" (ya normalizado en algunos registros)
--    Formato 2: "+18091234567" (completo, tomar últimos 4 dígitos)
update public.bookings
set phone_last4 = (
  case
    when guest_phone ~ '\*{2,}\d{4}$' then right(guest_phone, 4)
    when guest_phone ~ '\d{4}\D*$'    then right(regexp_replace(guest_phone, '\D', '', 'g'), 4)
    else null
  end
)
where phone_last4 is null
  and guest_phone is not null
  and length(regexp_replace(guest_phone, '\D', '', 'g')) >= 4;

-- ── Comentario sobre uso ────────────────────────────────────────────────────
-- La API /api/checkin/lookup busca con:
--   SELECT ... FROM bookings
--   WHERE tenant_id = current_tenant_id()
--     AND upper(channel_code) = upper($1)
--     AND phone_last4 = $2
-- El RLS existente ya scopea por tenant, pero el lookup en el API corre con
-- service_role (el huésped NO está autenticado) así que el query incluye el
-- tenant_id resuelto por el host en el share-link.
