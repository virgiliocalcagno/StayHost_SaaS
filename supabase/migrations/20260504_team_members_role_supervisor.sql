-- Permitir 'supervisor' como valor válido en team_members.role.
-- Sin esto, el INSERT del nuevo rol fallaba con
-- team_members_role_check y el endpoint POST /api/team-members
-- hacía rollback del auth.user creado, dejando al owner sin
-- forma de invitar supervisores.
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_role_check
  CHECK (role IN (
    'admin',
    'supervisor',
    'manager',
    'cleaner',
    'maintenance',
    'co_host',
    'guest_support',
    'owner',
    'accountant'
  ));
