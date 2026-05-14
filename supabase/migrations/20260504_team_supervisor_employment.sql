-- Sprint B (jerarquía) + Sprint C (employment_type) — modelo canónico de roles.
--
-- Una sola columna role en team_members ya define quién es admin, supervisor,
-- cleaner, maintenance. Acá agregamos:
--
--   * supervisor_id en team_members → cleaner reporta a su supervisor.
--   * supervisor_id en properties → propiedad bajo coordinación de un supervisor
--     (NULL = admin la maneja directo).
--   * employment_type en team_members → contractor cobra por tarea y ve montos,
--     employee cobra salario fuera del SaaS y NUNCA ve montos en la app.
--
-- Las tareas derivan supervisor de la propiedad — no se duplica la columna en
-- cleaning_tasks.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'contractor'
  CHECK (employment_type IN ('contractor', 'employee'));

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_members_supervisor_id_idx
  ON public.team_members(supervisor_id) WHERE supervisor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS properties_supervisor_id_idx
  ON public.properties(supervisor_id) WHERE supervisor_id IS NOT NULL;

COMMENT ON COLUMN public.team_members.supervisor_id IS
  'Supervisor del miembro. NULL = reporta directo al admin. Solo el admin reasigna entre supervisores.';
COMMENT ON COLUMN public.team_members.employment_type IS
  'contractor (cobra por tarea, ve montos) | employee (salario fuera del SaaS, NO ve montos en la app).';
COMMENT ON COLUMN public.properties.supervisor_id IS
  'Supervisor que coordina la propiedad. NULL = admin coordina directo. Tareas derivan su supervisor de acá.';
