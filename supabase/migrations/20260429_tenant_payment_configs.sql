-- ============================================================================
-- StayHost — pagos: configuración por tenant + tracking en bookings
-- Date: 2026-04-29
--
-- Why:
--   Cada host carga SUS propias credenciales de PayPal (u otro provider). El
--   dinero NO pasa por una cuenta central de StayHost — va directo del
--   huésped al PayPal del host. Esto evita que StayHost sea intermediario
--   financiero (ahorra KYC, complejidad legal en LATAM).
--
--   Si un host no configuró pagos, el botón "Pagar con PayPal" NO aparece
--   en el Hub público — el flujo cae al modelo manual (host coordina cobro
--   por WhatsApp como hasta ahora).
--
-- Tabla: tenant_payment_configs
--   - 1 fila por (tenant_id, provider). Ahora solo 'paypal'; en el futuro
--     'stripe', 'mercadopago', etc.
--   - client_secret se guarda en texto plano protegido por service_role +
--     RLS estricta (igual que ttlock_accounts.refresh_token). NUNCA se
--     devuelve al frontend; el GET enmascara con ••••.
--   - mode: 'sandbox' para tests, 'live' para producción.
--   - enabled: el host puede pausar pagos sin borrar credenciales.
--
-- bookings: campos de tracking
--   - payment_token: UUID que el huésped usa para acceder a la página
--     de pago `/hub/[hostId]/pay/[token]`. Generado al aprobar la solicitud.
--   - paid_at: cuándo se capturó el pago (NULL = no pagado).
--   - payment_provider, payment_id: trazabilidad del pago en el lado del
--     procesador (PayPal order id, Stripe payment_intent, etc.).
-- ============================================================================

create table if not exists public.tenant_payment_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('paypal')),
  client_id text,
  client_secret text,
  mode text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  enabled boolean not null default false,
  -- Etiqueta opcional para que el host distinga múltiples configs (no
  -- relevante hoy; reservado para futuro multi-config).
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create index if not exists tenant_payment_configs_tenant_idx
  on public.tenant_payment_configs (tenant_id);

-- RLS: el host solo ve/edita sus propios configs. Service_role hace bypass
-- para lectura desde endpoints públicos (huésped paga sin sesión).
alter table public.tenant_payment_configs enable row level security;

drop policy if exists tenant_payment_configs_owner_select on public.tenant_payment_configs;
create policy tenant_payment_configs_owner_select on public.tenant_payment_configs
  for select using (
    exists (select 1 from public.tenants t where t.id = tenant_payment_configs.tenant_id and t.user_id = auth.uid())
  );

drop policy if exists tenant_payment_configs_owner_modify on public.tenant_payment_configs;
create policy tenant_payment_configs_owner_modify on public.tenant_payment_configs
  for all using (
    exists (select 1 from public.tenants t where t.id = tenant_payment_configs.tenant_id and t.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.tenants t where t.id = tenant_payment_configs.tenant_id and t.user_id = auth.uid())
  );

-- ── bookings: campos de pago ───────────────────────────────────────────────
alter table public.bookings
  add column if not exists payment_token uuid,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_provider text,
  add column if not exists payment_id text;

-- Índice para resolver booking by payment_token (GET público de la página
-- de pago).
create unique index if not exists bookings_payment_token_uniq
  on public.bookings (payment_token)
  where payment_token is not null;

comment on column public.bookings.payment_token is
  'UUID que el huésped usa para acceder a /hub/[hostId]/pay/[token]. Generado al aprobar la solicitud.';
comment on column public.bookings.paid_at is
  'Timestamp de captura confirmada del pago. NULL = no pagado todavía.';
