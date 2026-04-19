-- ============================================================================
-- StayHost — checkin_records table + Storage bucket for guest ID photos
-- Date: 2026-04-19
--
-- Why:
--   `/api/checkin` used an in-memory `Map` that evaporated between serverless
--   invocations on Netlify. We move all guest check-in state to Postgres and
--   move the ID photo to a private Supabase Storage bucket so rows stay light.
--
-- Before running:
--   20260418_auth_rls.sql must have been applied (it enables RLS + generic
--   tenant policies for `checkin_records` — this migration just creates the
--   table and re-applies RLS so the policies kick in).
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. Table ────────────────────────────────────────────────────────────────

create table if not exists public.checkin_records (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Guest identity (lastName + last4 of phone = soft auth token for the guest)
  guest_name        text not null,
  guest_last_name   text not null,     -- stored lowercased for case-insensitive match
  last_four_digits  text not null,

  -- Stay details
  checkin           date not null,
  checkout          date not null,
  nights            int  not null default 1,

  -- Property snapshot (denormalised so the guest card survives property edits)
  property_id       text,
  property_name     text not null,
  property_address  text,
  property_image    text,
  wifi_ssid         text,
  wifi_password     text,

  -- Electricity upsell
  electricity_enabled   boolean not null default true,
  electricity_rate      numeric(10,2) not null default 5,
  electricity_paid      boolean not null default false,
  electricity_total     numeric(10,2) not null default 0,
  paypal_fee_included   boolean not null default true,

  -- ID photo lives in Storage at `checkin-ids/<tenant_id>/<id>.jpg`.
  -- We store only the object path, not the bytes.
  id_photo_path     text,
  id_status         text not null default 'pending'
    check (id_status in ('pending','uploaded','validated','rejected')),

  -- Access gate (guest can see wifi + door code only when true)
  access_granted    boolean not null default false,
  status            text not null default 'pendiente'
    check (status in ('pendiente','validado')),

  booking_ref       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists checkin_records_tenant_id_idx
  on public.checkin_records (tenant_id);

create index if not exists checkin_records_checkin_idx
  on public.checkin_records (tenant_id, checkin);

-- Re-apply the generic tenant RLS policies from the 20260418 migration. The
-- previous DO block skipped this table because it didn't exist yet.
alter table public.checkin_records enable row level security;

drop policy if exists checkin_records_select_own on public.checkin_records;
create policy checkin_records_select_own on public.checkin_records
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists checkin_records_insert_own on public.checkin_records;
create policy checkin_records_insert_own on public.checkin_records
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists checkin_records_update_own on public.checkin_records;
create policy checkin_records_update_own on public.checkin_records
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists checkin_records_delete_own on public.checkin_records;
create policy checkin_records_delete_own on public.checkin_records
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

-- ── 2. updated_at trigger ───────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists checkin_records_touch_updated_at on public.checkin_records;
create trigger checkin_records_touch_updated_at
  before update on public.checkin_records
  for each row execute function public.touch_updated_at();

-- ── 3. Storage bucket for ID photos ─────────────────────────────────────────
--
-- Private bucket. Staff reads/writes via service role from the route handler.
-- Guests never touch Storage directly — they POST base64 to /api/checkin which
-- uploads on their behalf. So no public or anon policies here.

insert into storage.buckets (id, name, public)
values ('checkin-ids', 'checkin-ids', false)
on conflict (id) do nothing;

-- Let authenticated tenants READ their own tenant's ID photos (needed only if
-- we ever serve them directly via signed URLs from a client; today we read
-- them server-side via admin client, but this keeps RLS consistent).
drop policy if exists checkin_ids_select_own on storage.objects;
create policy checkin_ids_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'checkin-ids'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ============================================================================
