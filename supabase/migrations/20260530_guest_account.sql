-- ============================================================================
-- StayHost — Sprint 8a: cuenta del huésped + historial transversal
-- Date: 2026-05-30
--
-- Why:
--   Hasta ahora una orden se identifica por (id, customer_token) — el
--   huésped abre el link del email y ya. Pero no puede ver TODAS sus
--   órdenes (de distintos hosts) en un solo lugar, ni revisar historial.
--
--   Solución: huésped se loguea con Google o magic-link (Supabase Auth).
--   Al loguearse, vinculamos todas sus órdenes pasadas por email match.
--   A futuro: cancelación con reglas + reorder + favoritos.
--
-- guest_auth_user_id es nullable porque:
--   - Órdenes anteriores al login del huésped no tienen vínculo
--   - El huésped puede comprar sin loguearse (flow actual sigue válido)
--   - Al loguearse, server vincula retroactivo por email match
-- ============================================================================

alter table public.service_orders
  add column if not exists guest_auth_user_id uuid;

comment on column public.service_orders.guest_auth_user_id is
  'auth.users.id del huésped si está logueado. NULL si compró sin cuenta o aún no se vinculó por email match.';

-- Index parcial para el lookup "todas las órdenes de este huésped" — solo
-- las vinculadas (filtramos NULL para que el index no se infle).
create index if not exists service_orders_guest_auth_user_idx
  on public.service_orders (guest_auth_user_id)
  where guest_auth_user_id is not null;

-- Index secundario sobre guest_email (case-insensitive) para el lookup
-- retroactivo al loguearse — "agarrá todas las órdenes con este email".
create index if not exists service_orders_guest_email_idx
  on public.service_orders (lower(guest_email))
  where guest_email is not null;
