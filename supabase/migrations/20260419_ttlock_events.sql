-- ============================================================================
-- StayHost — ttlock_events table for audited webhook ingestion
-- Date: 2026-04-19
--
-- Why:
--   `/api/ttlock/webhook` accepted anything and logged to stdout. We now
--   persist every incoming lock event so we can audit unlocks, debug missed
--   PINs, and build downstream features (cleaner arrival detection, guest
--   access timeline). Idempotency is enforced via a unique index on
--   (lock_id, server_date, record_type) so TTLock retries don't duplicate.
-- ============================================================================

create table if not exists public.ttlock_events (
  id               bigserial primary key,
  tenant_id        uuid references public.tenants(id) on delete set null,
  property_id      uuid references public.properties(id) on delete set null,
  lock_id          text not null,
  record_type      int,
  success          int,
  username         text,
  keyboard_pwd     text,
  server_date      bigint,          -- milliseconds, as TTLock sends it
  electric_quantity int,
  notify_type      int,
  raw              jsonb not null,  -- full payload (form → object)
  received_at      timestamptz not null default now()
);

-- Idempotency: TTLock occasionally re-delivers the same event. We never want
-- to count an unlock twice. `record_type` distinguishes lock/unlock/etc so
-- two events at the same ms are still fine if of different types.
create unique index if not exists ttlock_events_idempotency_idx
  on public.ttlock_events (lock_id, server_date, record_type)
  where server_date is not null and record_type is not null;

create index if not exists ttlock_events_tenant_idx
  on public.ttlock_events (tenant_id, received_at desc);

create index if not exists ttlock_events_property_idx
  on public.ttlock_events (property_id, received_at desc);

-- RLS: tenants can read their own events. Inserts happen exclusively from the
-- webhook (service role) so no insert policy is granted to authenticated.
alter table public.ttlock_events enable row level security;

drop policy if exists ttlock_events_select_own on public.ttlock_events;
create policy ttlock_events_select_own on public.ttlock_events
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
