-- Sprint B — auditoria de aprobaciones de evidencia.
--
-- Cada aprobacion / pedido de re-foto / escalacion al admin se anexa al log.
-- Estructura de cada entrada (jsonb):
--   { "by": "<team_member_id>" | "auto",
--     "role": "supervisor" | "admin",
--     "action": "approved" | "rejected" | "escalated",
--     "at": "<iso timestamp>",
--     "note": "<opcional, motivo del rechazo o nota>" }
--
-- Se elige jsonb (array dentro de jsonb) en vez de jsonb[] para facilitar
-- jsonb_array_append y queries con jsonb_path_query.

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS approval_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.cleaning_tasks.approval_log IS
  'Historial cronologico de aprobaciones/rechazos. Append-only desde la app. Cada entrada: {by, role, action, at, note}.';
