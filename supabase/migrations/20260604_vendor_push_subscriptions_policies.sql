-- ============================================================================
-- Defensa en profundidad: policies explícitas en vendor_push_subscriptions.
-- La tabla ya tiene RLS enabled pero no tenía policies, y todos los queries
-- pasan por supabaseAdmin (que bypassea RLS). Agregamos policies para que
-- si en el futuro algún endpoint usa la sesión, no pueda leer suscripciones
-- de vendors de otro tenant.
-- ============================================================================

drop policy if exists vendor_push_subscriptions_tenant_own
  on public.vendor_push_subscriptions;

create policy vendor_push_subscriptions_tenant_own
  on public.vendor_push_subscriptions
  for all
  using (
    vendor_id in (
      select id from public.upsell_vendors
      where tenant_id = public.current_tenant_id()
    )
  )
  with check (
    vendor_id in (
      select id from public.upsell_vendors
      where tenant_id = public.current_tenant_id()
    )
  );
