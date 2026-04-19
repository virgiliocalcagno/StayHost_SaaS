# Supabase migrations

Versioned SQL migrations for StayHost. Run them in order against your Supabase project.

## How to run

### Option A — Supabase Studio (easiest for now)

1. Open https://supabase.com → your project → **SQL Editor**.
2. Open each `.sql` file in order (by date prefix).
3. Paste → **Run**.
4. Check for errors in the output pane.

### Option B — Supabase CLI

```bash
supabase link --project-ref <YOUR_REF>
supabase db push
```

This reads every file in `supabase/migrations/` in order.

## Migrations

### `20260418_auth_rls.sql`

Foundational auth + RLS migration. **Run this first.**

Before running:

1. In Supabase Studio → **Authentication** → **Users** → **Add user**.
   Email: `virgiliocalcagno@gmail.com`, password: (pick one you'll use to log in).
2. Then run the SQL. It will:
   - Add `tenants.user_id` FK → `auth.users.id`.
   - Enable RLS on all tenant-scoped tables.
   - Create `tenant_id = current_tenant_id()` policies on each.
   - Backfill: links existing tenant rows to their auth user by matching email.

After running, verify with:

```sql
select id, email, user_id from public.tenants;
-- user_id should be populated for every real tenant.
```

If a tenant's `user_id` is still null, the email in `tenants.email` doesn't
match the email in `auth.users`. Fix one side and re-run the backfill at the
bottom of the file.
