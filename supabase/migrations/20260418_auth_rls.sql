-- ============================================================================
-- StayHost — Auth + RLS foundational migration
-- Date: 2026-04-18
--
-- What this does:
--   1. Links the existing `tenants` table to Supabase Auth via user_id.
--   2. Defines a helper function `public.current_tenant_id()` that returns
--      the tenant_id of the currently authenticated user (via auth.uid()).
--   3. Enables Row Level Security on every tenant-scoped table.
--   4. Creates policies so each tenant only sees their own rows.
--
-- This script is idempotent — it can be run multiple times safely.
--
-- BEFORE RUNNING:
--   1. Create the owner user in Supabase Auth Studio (email/password) with
--      email = virgiliocalcagno@gmail.com. Copy the resulting user_id.
--   2. If `tenants` has an existing row for that email, the backfill at the
--      bottom will link it. Otherwise edit the INSERT to match your schema.
--
-- AFTER RUNNING:
--   - Verify: `select id, email, user_id from tenants;` — every row should
--     have a non-null user_id.
--   - Verify RLS: `set role authenticated; select * from properties;` should
--     only return rows for the current user.
-- ============================================================================

-- ── 1. Link tenants to auth.users ───────────────────────────────────────────

alter table public.tenants
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists tenants_user_id_key on public.tenants (user_id)
  where user_id is not null;

-- ── 2. Helper: resolve the current user's tenant_id from auth.uid() ─────────
--
-- Using a SECURITY DEFINER function means policies don't need to re-query
-- tenants themselves, keeping them fast and readable.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.tenants
  where user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_tenant_id() to authenticated;

-- ── 3. Enable RLS on every tenant-scoped table ──────────────────────────────
--
-- If a table doesn't exist in your schema yet, comment the line out. The DO
-- block below skips tables that don't exist instead of erroring.

do $$
declare
  t text;
  tenant_tables text[] := array[
    'tenants',
    'properties',
    'bookings',
    'ttlock_config',
    'cleaning_tasks',
    'checkin_records'   -- create this later when migrating /api/checkin out of memory
  ];
begin
  foreach t in array tenant_tables loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- ── 4. Policies ─────────────────────────────────────────────────────────────
--
-- Naming convention: <table>_<operation>_own
-- Every policy is dropped-then-created so the migration is idempotent.

-- 4.1 tenants: a user sees/updates only their own tenant row.
drop policy if exists tenants_select_own on public.tenants;
create policy tenants_select_own on public.tenants
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists tenants_update_own on public.tenants;
create policy tenants_update_own on public.tenants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- tenants INSERT is handled server-side during signup (see /auth/callback or
-- /register handler) using the service role, so no INSERT policy is needed.

-- 4.2 Generic helper: apply "tenant_id = current_tenant_id()" policy to a
-- table. Using a DO block keeps the SQL DRY and skips non-existent tables.

do $$
declare
  t text;
  tenant_scoped text[] := array[
    'properties',
    'bookings',
    'ttlock_config',
    'cleaning_tasks',
    'checkin_records'
  ];
begin
  foreach t in array tenant_scoped loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- ── 5. Backfill: link existing tenant rows to their auth.users row ──────────
--
-- This matches by email. If you haven't created the owner user in Supabase
-- Auth yet, this UPDATE is a no-op and can be re-run after you do.

update public.tenants t
set user_id = u.id
from auth.users u
where t.user_id is null
  and lower(t.email) = lower(u.email);

-- ── 6. Sanity check (run manually after migration) ──────────────────────────
--
--   select t.id, t.email, t.user_id, u.email as auth_email
--   from public.tenants t
--   left join auth.users u on u.id = t.user_id;
--
-- Every tenant row that represents a real user should have user_id filled in.
-- ============================================================================
