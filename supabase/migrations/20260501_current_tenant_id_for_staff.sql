-- ============================================================================
-- StayHost — current_tenant_id() resuelve también para staff
-- Date: 2026-05-01
--
-- Bug raíz: la función `public.current_tenant_id()` solo buscaba en
-- `tenants.user_id = auth.uid()` (owner). Para staff (Sofia, limpiadoras,
-- mantenimiento) la función devolvía NULL → todas las RLS policies que
-- filtran por `tenant_id = current_tenant_id()` los bloqueaban → no veían
-- ni sus propias tareas asignadas.
--
-- Fix: hacer que la función mire también en `team_members.auth_user_id`.
-- Si el usuario es owner → su tenant. Si es staff → el tenant al que
-- pertenece como team_member.
--
-- IMPORTANTE: esto da a TODO staff acceso de SELECT/INSERT/UPDATE/DELETE
-- a su tenant via RLS. La granularidad por rol (cleaner solo ve sus tareas,
-- no puede crear team_members) NO se hace en BD — se hace en la capa de
-- API (validación de role en route handlers). Es V2.
-- ============================================================================

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select id from public.tenants where user_id = auth.uid() limit 1),
    (select tenant_id from public.team_members where auth_user_id = auth.uid() limit 1)
  );
$$;

comment on function public.current_tenant_id() is
  'Resuelve el tenant_id del usuario autenticado. Mira primero tenants.user_id (owner), después team_members.auth_user_id (staff). Devuelve NULL si el usuario no pertenece a ningún tenant.';
