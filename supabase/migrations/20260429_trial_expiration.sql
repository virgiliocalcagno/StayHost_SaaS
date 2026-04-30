-- ============================================================================
-- StayHost — Trial 14 dias con expiracion real
-- Date: 2026-04-29
--
-- Por que:
--   El header de la landing prometia "Prueba Gratis 14 Dias" pero ningun
--   trigger seteaba `plan_expires_at`, asi que un usuario en trial podia
--   usar el SaaS para siempre. Ahora el trigger setea +14 dias y un
--   backfill cubre los tenants ya creados.
--
-- Que hace:
--   1) Reemplaza handle_new_auth_user para incluir plan_expires_at en el
--      INSERT inicial.
--   2) Backfillea tenants en plan='trial' que no tengan plan_expires_at:
--      les setea created_at + 14 dias.
--
-- Idempotente: se puede correr varias veces.
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
  -- Si ya existe un tenant para este email, le linkeamos el user_id.
  update public.tenants
  set user_id = new.id
  where user_id is null
    and lower(email) = lower(new.email);

  -- Si despues del update todavia no hay tenant, lo creamos con trial.
  if not exists (select 1 from public.tenants where user_id = new.id) then
    display_name := coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    );

    insert into public.tenants (
      user_id, email, name,
      plan, status, plan_expires_at,
      created_by_admin
    )
    values (
      new.id, new.email, display_name,
      'trial', 'trial', now() + interval '14 days',
      false
    );
  end if;

  return new;
end;
$$;

grant execute on function public.handle_new_auth_user() to anon, authenticated, service_role;

-- ── Backfill: tenants en trial sin plan_expires_at ────────────────────────
-- Para los que ya estan registrados sin fecha, computamos created_at + 14d.
-- Si created_at + 14d ya paso, igual se setea — el flow va a tratarlos como
-- expirados (correcto, porque ya consumieron el trial).
update public.tenants
set plan_expires_at = created_at + interval '14 days'
where plan = 'trial'
  and plan_expires_at is null;

-- ── Sanity check ─────────────────────────────────────────────────────────
-- select id, email, plan, plan_expires_at,
--        plan_expires_at < now() as expired
-- from public.tenants
-- order by created_at desc;
