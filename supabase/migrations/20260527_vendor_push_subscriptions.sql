-- ============================================================================
-- StayHost — Sprint 7.5: Web Push subscriptions del vendor
-- Date: 2026-05-27
--
-- Why:
--   En Punta Cana los vendors no revisan email seguido — email sirve solo
--   como constancia documental. Para notificación operativa instantánea
--   necesitamos:
--     A) WhatsApp click-to-chat desde el huésped (gratis, sin setup)
--     B) Web Push notifications a la PWA del vendor (server-to-vendor real)
--
--   Esta migración prepara la tabla de subscriptions para canal B. El
--   vendor abre /v/[token] la primera vez, acepta notifications, queda
--   suscripto. A partir de la siguiente orden el server le manda push
--   directo aunque la PWA esté cerrada.
--
--   Una subscription puede ser para múltiples órdenes del mismo vendor
--   (un vendor recibe muchas órdenes a lo largo del tiempo desde
--   distintas órdenes — la suscripción la vinculamos por vendor_id).
-- ============================================================================

create table if not exists public.vendor_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.upsell_vendors(id) on delete cascade,
  -- endpoint es la URL del push service (FCM, Mozilla, Apple) que devuelve
  -- el browser. UNIQUE global porque un mismo endpoint solo puede
  -- pertenecer a un vendor a la vez. Si el usuario cambia de browser/
  -- device, se genera un endpoint distinto y se crea una row nueva.
  endpoint      text not null unique,
  -- p256dh + auth son las claves de encriptación del push subscription.
  -- web-push las usa para encriptar el payload antes de mandar.
  p256dh        text not null,
  auth_key      text not null,
  -- Audit
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  -- Cuando el push service devuelve 410 Gone, marcamos como expired y la
  -- excluimos de envíos futuros sin borrar la row (audit).
  expired_at    timestamptz
);

create index if not exists vendor_push_subscriptions_vendor_idx
  on public.vendor_push_subscriptions (vendor_id)
  where expired_at is null;

comment on table public.vendor_push_subscriptions is
  'Web Push subscriptions de cada vendor para notificaciones instantáneas. Una row por (vendor, browser/device).';
comment on column public.vendor_push_subscriptions.endpoint is
  'URL del push service. UNIQUE — si el browser regenera la sub, replace.';
comment on column public.vendor_push_subscriptions.expired_at is
  'Marca soft-delete cuando el push service devuelve 410 Gone. Mantenemos la row para audit.';

-- RLS — la tabla la accede SOLO supabaseAdmin desde server. No habilitamos
-- RLS porque ninguna sesión cliente la lee/escribe directo. Pero le
-- ponemos enable + sin policies para que cualquier intento desde sesión
-- cliente sea rechazado por default.
alter table public.vendor_push_subscriptions enable row level security;
