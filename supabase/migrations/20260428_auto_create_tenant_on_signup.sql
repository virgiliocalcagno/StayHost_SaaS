-- ============================================================================
-- StayHost — Auto-create tenant row when a new auth user is created
-- Date: 2026-04-28
--
-- Problema:
--   El proyecto requiere que cada usuario tenga una fila en `public.tenants`
--   para que `current_tenant_id()` resuelva y las RLS policies dejen ver sus
--   propios datos. Hasta ahora el INSERT en tenants estaba "TODO en /register
--   handler" y nunca se implemento, asi que un usuario que se registra queda
--   huerfano (puede entrar al dashboard pero sus consultas devuelven vacio,
--   o peor, segun la ruta).
--
-- Solucion:
--   Trigger AFTER INSERT en auth.users que crea la fila en tenants. Es la
--   forma mas a prueba de balas: no importa por donde signup-eo el user
--   (form de la app, Supabase Studio, OAuth callback, magic link, etc),
--   siempre tendra su tenant.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text;
begin
  -- Si ya existe un tenant para este email (caso del Master pre-existente
  -- linkeado por la migracion 20260418), simplemente le linkeamos el user_id
  -- en vez de crear duplicado.
  update public.tenants
  set user_id = new.id
  where user_id is null
    and lower(email) = lower(new.email);

  -- Si despues del update todavia no hay tenant para este user, lo creamos.
  if not exists (select 1 from public.tenants where user_id = new.id) then
    display_name := coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    );

    insert into public.tenants (user_id, email, name)
    values (new.id, new.email, display_name);
  end if;

  return new;
end;
$$;

-- Permiso para que Supabase Auth (rol postgres / service_role) pueda invocar
-- la function via trigger. SECURITY DEFINER ya nos garantiza el insert.
grant execute on function public.handle_new_auth_user() to anon, authenticated, service_role;

-- Trigger: corre despues de insertar en auth.users.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ── Backfill: cubrir auth.users que ya existen sin tenant linkeado ──────────
-- Esto recoge usuarios que se hayan registrado entre 20260418 y hoy sin que
-- el handler los linkeara.
do $$
declare
  u record;
  display_name text;
begin
  for u in
    select au.id, au.email, au.raw_user_meta_data
    from auth.users au
    where not exists (select 1 from public.tenants t where t.user_id = au.id)
  loop
    -- Mismo orden que el trigger: primero matchear por email.
    update public.tenants
    set user_id = u.id
    where user_id is null
      and lower(email) = lower(u.email);

    if not exists (select 1 from public.tenants where user_id = u.id) then
      display_name := coalesce(
        nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
        split_part(u.email, '@', 1)
      );

      insert into public.tenants (user_id, email, name)
      values (u.id, u.email, display_name);
    end if;
  end loop;
end $$;

-- ── Sanity check (correr a mano despues de aplicar) ─────────────────────────
--
--   select au.id, au.email,
--          t.id as tenant_id, t.name as tenant_name
--   from auth.users au
--   left join public.tenants t on t.user_id = au.id
--   order by au.created_at desc;
--
-- Cada fila de auth.users debe tener tenant_id NO null.
-- ============================================================================
