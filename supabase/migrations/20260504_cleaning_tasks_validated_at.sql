-- Sprint C-MVP: la wallet del cleaner agrupa tareas por validated_at.
--
-- La columna también la añade `feat/cleaning-evidence-real` (junto con
-- validated_by y rejection_note). Acá la replicamos con IF NOT EXISTS para
-- que esta rama sea autocontenida: si esa otra rama mergea primero, esta
-- migración es no-op; si esta mergea primero, la otra también es no-op.

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

COMMENT ON COLUMN public.cleaning_tasks.validated_at IS
  'Timestamp en que el supervisor aprobó la limpieza. NULL = sin aprobar. La wallet del cleaner usa este campo para agrupar tareas pagables por semana.';
