-- ============================================================================
-- StayHost — team_members: link a auth.users + soporte phone-as-login
-- Date: 2026-05-01
--
-- Why:
--   El POST /api/team-members solo insertaba en team_members. Nunca creaba
--   cuenta en auth.users → la limpiadora no podía loguearse en /acceso.
--   El form mostraba un campo "password" que se imprimía en WhatsApp pero
--   se perdía. Resultado: todas las limpiadoras eran cuentas fantasma.
--
--   Decisión 2026-05-01 (memoria project_staff_auth_decision.md):
--   - Cuenta real en Supabase Auth para cada team_member.
--   - Soporta email O teléfono. Si solo phone, el backend genera pseudo-email
--     `+{phone}+{tenantSlug}@stayhost.local` para satisfacer el constraint
--     de email único de auth.users.
--   - Esta migración solo agrega el FK; la lógica de creación va en el
--     endpoint POST /api/team-members.
-- ============================================================================

alter table public.team_members
  add column if not exists auth_user_id uuid
    references auth.users(id)
    on delete set null;

create index if not exists team_members_auth_user_idx
  on public.team_members (auth_user_id);

comment on column public.team_members.auth_user_id is
  'FK a auth.users — cuenta real con la que el staff loguea. NULL para miembros legacy creados antes de 2026-05-01 que nunca tuvieron Auth.';
