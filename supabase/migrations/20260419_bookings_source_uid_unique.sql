-- ============================================================================
-- StayHost — bookings: (property_id, source_uid) uniqueness
-- Date: 2026-04-19
--
-- Why:
--   `POST /api/bookings` now does an app-level overlap check, but between
--   SELECT and INSERT a concurrent request could slip through. More
--   importantly, `/api/ical/import` already upserts with
--     onConflict: "property_id,source_uid"
--   which silently no-ops unless the supporting index exists.
--
--   A single index on (property_id, source_uid) covers both:
--     - iCal retries from Airbnb/VRBO (same UID → idempotent upsert)
--     - Manual creates where the client passes a sourceUid for double-click
--       safety — /api/bookings now returns { ok: true, idempotent: true } on
--       23505 instead of 500.
--
--   `if not exists` makes this safe to run even if the index was added
--   ad-hoc in prod before migrations were tracked.
-- ============================================================================

create unique index if not exists bookings_property_source_uid_idx
  on public.bookings (property_id, source_uid)
  where source_uid is not null;
