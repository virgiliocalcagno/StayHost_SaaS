-- ============================================================================
-- StayHost — add source / channel / missing_data to checkin_records
-- Date: 2026-04-19
--
-- Why:
--   The dashboard panel (CheckInsPanel) distinguishes between records that
--   came from direct bookings, iCal feeds, or were entered manually. It also
--   flags records that lack guest identity data. We persist those flags so
--   the dashboard renders identically after reloading from the backend.
-- ============================================================================

alter table public.checkin_records
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'auto_direct', 'auto_ical')),
  add column if not exists channel text,
  add column if not exists missing_data boolean not null default false;

create index if not exists checkin_records_booking_ref_idx
  on public.checkin_records (tenant_id, booking_ref)
  where booking_ref is not null;
