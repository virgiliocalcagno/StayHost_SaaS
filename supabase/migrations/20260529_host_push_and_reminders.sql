-- ============================================================================
-- StayHost — Sprint 7.8: push al host + recordatorios 24h
-- Date: 2026-05-29
--
-- Cierre operativo del módulo Ventas Extras:
--   1) Push al host cuando vendor decline (cierra el loop sin email)
--   2) Recordatorio 24h antes del servicio (reduce no-shows)
--
-- Estructura similar a vendor_push_subscriptions (Sprint 7.5) pero con
-- referencia a tenant+user en lugar de vendor — el host tiene cuenta auth
-- de verdad. Una sub por (user, browser/device).
-- ============================================================================

-- Push subscriptions del HOST (admin/owner del tenant).
create table if not exists public.host_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  auth_user_id  uuid not null,           -- de auth.users, no FK porque cross-schema
  endpoint      text not null unique,
  p256dh        text not null,
  auth_key      text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expired_at    timestamptz
);

create index if not exists host_push_subscriptions_tenant_idx
  on public.host_push_subscriptions (tenant_id)
  where expired_at is null;

create index if not exists host_push_subscriptions_user_idx
  on public.host_push_subscriptions (auth_user_id)
  where expired_at is null;

comment on table public.host_push_subscriptions is
  'Push subscriptions del owner/admin del tenant para recibir alerts críticos (vendor decline, recordatorios, etc).';
comment on column public.host_push_subscriptions.expired_at is
  'Soft-delete cuando push service devuelve 410 Gone.';

-- RLS — el endpoint usa supabaseAdmin tras auth de sesión, así que la tabla
-- queda sin policies activas. Habilitamos RLS para rechazar acceso directo.
alter table public.host_push_subscriptions enable row level security;

-- ── Recordatorios 24h ─────────────────────────────────────────────────────
-- Track si ya mandamos el recordatorio para no duplicar al re-correr el cron.
alter table public.service_orders
  add column if not exists reminder_sent_at timestamptz;

comment on column public.service_orders.reminder_sent_at is
  'Timestamp del envío del recordatorio 24h antes del servicio. NULL = nunca enviado. El cron skip órdenes con este campo no-nulo.';
