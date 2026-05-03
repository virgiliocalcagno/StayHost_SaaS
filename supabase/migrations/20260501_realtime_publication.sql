-- ============================================================================
-- StayHost — habilitar Supabase Realtime en tablas operativas
-- Date: 2026-05-01
--
-- Why:
--   El owner panel (CleaningPanel) y la app de la limpiadora (/staff)
--   necesitan sync en tiempo real. Cuando el owner asigna una tarea,
--   la limpiadora la ve al instante. Cuando ella la acepta/rechaza/
--   completa, el owner ve el cambio sin refrescar.
--
--   Supabase Realtime usa publicaciones de Postgres (logical replication).
--   Las tablas tienen que estar agregadas a `supabase_realtime` para que
--   los eventos lleguen a los clientes suscritos.
--
-- RLS:
--   No hace falta tocar las policies. Los clientes solo reciben eventos
--   de las rows que pueden ver via SELECT — lo cual ya está cubierto
--   por las policies existentes (tenant_id = current_tenant_id()).
-- ============================================================================

-- Habilitar realtime para cleaning_tasks (owner ↔ staff sync).
alter publication supabase_realtime add table public.cleaning_tasks;

-- Habilitar realtime para team_members (status pending → active visible
-- al instante en el panel del owner).
alter publication supabase_realtime add table public.team_members;
