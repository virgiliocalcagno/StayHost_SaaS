-- Add configurable check-in/check-out times per property.
-- Defaults match the industry standard (14:00 in, 12:00 out).
-- Used by auto-PIN creation to set validity windows.

alter table public.properties
  add column if not exists check_in_time  text not null default '14:00',
  add column if not exists check_out_time text not null default '12:00';
