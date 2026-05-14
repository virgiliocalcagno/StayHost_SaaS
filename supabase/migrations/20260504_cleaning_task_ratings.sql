-- Sprint B-MVP: rating supervisor/dueño → cleaner por tarea validada.
-- Una rating por (task, rater) pair. Estrellas 1-5, nota opcional.
-- El supervisor califica al validar; el dueño puede sobre-rateaer aparte.

CREATE TABLE IF NOT EXISTS public.cleaning_task_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL REFERENCES public.cleaning_tasks(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  rated_by uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  rater_role text NOT NULL CHECK (rater_role IN ('supervisor','owner','admin','manager')),
  stars int NOT NULL CHECK (stars >= 1 AND stars <= 5),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, rated_by)
);

CREATE INDEX IF NOT EXISTS idx_cleaning_task_ratings_cleaner
  ON public.cleaning_task_ratings(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_task_ratings_tenant
  ON public.cleaning_task_ratings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_task_ratings_task
  ON public.cleaning_task_ratings(task_id);

ALTER TABLE public.cleaning_task_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaning_task_ratings_select ON public.cleaning_task_ratings;
CREATE POLICY cleaning_task_ratings_select
  ON public.cleaning_task_ratings FOR SELECT
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS cleaning_task_ratings_insert ON public.cleaning_task_ratings;
CREATE POLICY cleaning_task_ratings_insert
  ON public.cleaning_task_ratings FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS cleaning_task_ratings_update ON public.cleaning_task_ratings;
CREATE POLICY cleaning_task_ratings_update
  ON public.cleaning_task_ratings FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS cleaning_task_ratings_delete ON public.cleaning_task_ratings;
CREATE POLICY cleaning_task_ratings_delete
  ON public.cleaning_task_ratings FOR DELETE
  USING (tenant_id = current_tenant_id());

-- Vista agregada para mostrar promedio por cleaner sin tener que hacer GROUP BY
-- en cada panel. SECURITY INVOKER hace que la view se ejecute con los
-- privilegios del usuario que la consulta — sin esto, las views de Postgres
-- corren como el owner y bypasean RLS de la tabla base.
CREATE OR REPLACE VIEW public.cleaner_rating_summary
WITH (security_invoker = on)
AS
SELECT
  cleaner_id,
  tenant_id,
  COUNT(*) AS rating_count,
  ROUND(AVG(stars)::numeric, 2) AS rating_avg,
  MAX(created_at) AS last_rated_at
FROM public.cleaning_task_ratings
GROUP BY cleaner_id, tenant_id;
