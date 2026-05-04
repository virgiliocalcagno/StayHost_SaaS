-- ============================================================================
-- Cleaning evidence: real photos in Storage + supervisor validation columns
-- ============================================================================
--
-- Hasta hoy las fotos de cierre de limpieza eran un mock (URLs hardcoded a
-- unsplash en src/components/staff-ui/StaffWizard.tsx). Cleaner subía y
-- supervisor "veía" siempre la misma foto de un piso de Unsplash. Cero
-- evidencia real, cero anti-fraude.
--
-- Esta migración monta la base para fotos reales:
--
--   1. Bucket privado `cleaning-evidence` con misma convención que
--      `checkin-ids`: path = {tenant_id}/{task_id}/{category}-{timestamp}.jpg.
--      Subida y lectura siempre via supabaseAdmin desde route handlers — el
--      cliente nunca toca Storage directo. La policy de SELECT existe solo
--      por consistencia y para futuros signed URLs.
--
--   2. Columnas de validación en cleaning_tasks: validated_at, validated_by,
--      rejection_note. Permiten al supervisor aprobar/rechazar con audit
--      trail mínimo (en V2 se reemplaza por approval_log jsonb[] con
--      historial completo cuando entre el módulo Equipos & Jerarquía).
--
-- Referencias:
--   - feedback_evidencia_fotos.md — spec del timestamp quemado y pipeline
--   - project_modulo_equipos_jerarquia.md — Sprint B se construye encima
--   - 20260419_checkin_records.sql — patrón storage que copiamos
-- ============================================================================

-- ── 1. Storage bucket ──────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('cleaning-evidence', 'cleaning-evidence', false)
on conflict (id) do nothing;

-- Permitir SELECT a usuarios autenticados sobre fotos de su propio tenant.
-- Hoy todo el acceso es server-side via supabaseAdmin, pero la policy queda
-- por consistencia con checkin-ids y por si en el futuro servimos signed
-- URLs directas al cliente.
drop policy if exists cleaning_evidence_select_own on storage.objects;
create policy cleaning_evidence_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cleaning-evidence'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ── 2. Columnas de validación en cleaning_tasks ───────────────────────────

alter table public.cleaning_tasks
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references public.team_members(id) on delete set null,
  add column if not exists rejection_note text;

comment on column public.cleaning_tasks.validated_at is
  'Timestamp en que el supervisor (o admin) aprobó la limpieza tras revisar la evidencia. NULL = aún sin aprobar.';
comment on column public.cleaning_tasks.validated_by is
  'team_member que aprobó la tarea. Puede ser supervisor de la propiedad o admin actuando como override.';
comment on column public.cleaning_tasks.rejection_note is
  'Motivo cuando el supervisor pide re-foto: la tarea vuelve a in_progress y el cleaner ve esta nota en /staff. Se limpia al re-aprobar.';

-- Índice parcial para acelerar la query "tareas pendientes de validar"
-- (vista CleaningPanel "A validar"). Filtra solo las que están esperando.
create index if not exists cleaning_tasks_pending_validation_idx
  on public.cleaning_tasks (tenant_id, is_waiting_validation)
  where is_waiting_validation = true and validated_at is null;
