-- ============================================================================
-- StayHost — ttlock_accounts: multi-account TTLock per tenant
-- Date: 2026-04-19
--
-- Why:
--   The old `ttlock_config` table was 1:1 with tenant and stored the
--   per-tenant client_id/client_secret + plain-text password. Two problems:
--     1. A tenant can legitimately own more than one TTLock account (bought
--        locks under different emails over time). Single row per tenant
--        forced them to merge accounts — which TTLock doesn't support.
--     2. We never want to store the user's TTLock password in plain text.
--        The refresh_token is sufficient to renew access.
--
--   This migration creates `ttlock_accounts` (N per tenant) and also adds
--   `ttlock_account_id` to `properties` so a property can point to which
--   account owns its lock.
--
--   `ttlock_config` is intentionally left in place for now; the old /api/
--   ttlock/code endpoint still reads it. Once the new endpoint replaces it
--   we can drop the old table in a follow-up migration.
-- ============================================================================

create table if not exists public.ttlock_accounts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  label             text not null,                  -- "Casa playa", "Edificio centro"
  ttlock_username   text not null,                  -- email/phone used on the TTLock app
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  last_synced_at    timestamptz,                    -- last time we pulled locks
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A tenant can't have two accounts with the same username. Two different
-- tenants CAN have the same username (someone sharing their login with a
-- property manager).
create unique index if not exists ttlock_accounts_tenant_username_idx
  on public.ttlock_accounts (tenant_id, ttlock_username);

create index if not exists ttlock_accounts_tenant_idx
  on public.ttlock_accounts (tenant_id, created_at desc);

-- Touch updated_at automatically. Reuses the function created for
-- checkin_records on 2026-04-19; fall back to inline definition here in case
-- migrations run out of order.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ttlock_accounts_touch_updated_at on public.ttlock_accounts;
create trigger ttlock_accounts_touch_updated_at
  before update on public.ttlock_accounts
  for each row execute function public.touch_updated_at();

-- RLS: tenants see/manage only their own accounts.
alter table public.ttlock_accounts enable row level security;

drop policy if exists ttlock_accounts_select_own on public.ttlock_accounts;
create policy ttlock_accounts_select_own on public.ttlock_accounts
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists ttlock_accounts_insert_own on public.ttlock_accounts;
create policy ttlock_accounts_insert_own on public.ttlock_accounts
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists ttlock_accounts_update_own on public.ttlock_accounts;
create policy ttlock_accounts_update_own on public.ttlock_accounts
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists ttlock_accounts_delete_own on public.ttlock_accounts;
create policy ttlock_accounts_delete_own on public.ttlock_accounts
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

-- Link properties to an account. Nullable — a property without a lock has no
-- account either.
alter table public.properties
  add column if not exists ttlock_account_id uuid
  references public.ttlock_accounts(id) on delete set null;

create index if not exists properties_ttlock_account_idx
  on public.properties (ttlock_account_id);
