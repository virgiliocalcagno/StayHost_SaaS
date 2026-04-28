-- ============================================================================
-- StayHost — Fix: trigger handle_new_auth_user incluye columnas NOT NULL
-- Date: 2026-04-28 (sigue a 20260428_auto_create_tenant_on_signup)
--
-- Bug: la tabla public.tenants tiene status y created_by_admin como NOT NULL
-- pero el trigger original no los proveia, asi que el INSERT fallaba en
-- silencio y el nuevo user quedaba huerfano.
--
-- Fix: CREATE OR REPLACE de la function con los campos NOT NULL incluidos.
-- El trigger en si no se toca — apunta a la function por nombre y agarra
-- la version nueva automaticamente.
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
  -- Si ya existe un tenant para este email (caso del Master pre-existente),
  -- linkeamos el user_id en vez de duplicar. No tocamos status/plan: dejamos
  -- los que ya tenia.
  update public.tenants
  set user_id = new.id
  where user_id is null
    and lower(email) = lower(new.email);

  -- Si no quedo linkeado, lo creamos con los defaults para una prueba gratis.
  if not exists (select 1 from public.tenants where user_id = new.id) then
    display_name := coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    );

    insert into public.tenants (
      user_id,
      email,
      name,
      status,
      created_by_admin,
      plan
    )
    values (
      new.id,
      new.email,
      display_name,
      'active',
      false,
      'starter'
    );
  end if;

  return new;
end;
$$;

grant execute on function public.handle_new_auth_user() to anon, authenticated, service_role;
