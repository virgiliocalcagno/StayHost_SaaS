-- ============================================================================
-- StayHost — tenants: campos SaaS (plan, status, billing manual)
-- Date: 2026-04-19
--
-- Why:
--   El AdminPanel "SaaS Intelligence Center" necesita campos que no estaban en
--   la tabla original (era un schema mínimo para auth). Agregamos:
--
--     - plan               : plan comercial actual (trial / starter / growth / master)
--     - plan_expires_at    : para billing manual (cron chequea → grace → free)
--     - status             : active / trial / suspended / churned (cortado del plan)
--     - company            : nombre legal/comercial (opcional, separado del nombre)
--     - last_login_at      : cuándo entró por última vez — lo escribe /api/me
--     - created_by_admin   : flag para distinguir altas manuales (vos desde el
--                            panel) de auto-registros (via /register cuando se
--                            active). Útil para métricas.
--
--   Todo es `if not exists` / `if ... then` para que corra idempotente aunque
--   ya hayas agregado alguno a mano desde Supabase Studio.
-- ============================================================================

alter table public.tenants
  add column if not exists plan text not null default 'trial'
    check (plan in ('trial', 'starter', 'growth', 'master')),
  add column if not exists plan_expires_at timestamptz,
  add column if not exists status text not null default 'trial'
    check (status in ('active', 'trial', 'suspended', 'churned')),
  add column if not exists company text,
  add column if not exists last_login_at timestamptz,
  add column if not exists created_by_admin boolean not null default false;

-- Índice para el panel de admin: filtrar por status + plan es la query más común.
create index if not exists tenants_status_plan_idx
  on public.tenants (status, plan);

-- Índice para expiración — lo va a usar el cron de billing cuando lleguemos
-- a esa parte de la Fase E.
create index if not exists tenants_plan_expires_idx
  on public.tenants (plan_expires_at)
  where plan_expires_at is not null;
