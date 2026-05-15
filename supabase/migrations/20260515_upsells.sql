-- ============================================================================
-- StayHost — upsells: catálogo de servicios extras vendibles al huésped
-- Date: 2026-05-15
--
-- Why:
--   El módulo "Ventas Extras" (UpsellsPanel) tenía la UI hecha pero sin
--   persistencia — los productos vivían en useState y se perdían al recargar.
--   Esta tabla guarda el catálogo del host: tours, transporte, suministros,
--   late check-out, lavandería, etc. Sprint 1 solo persiste lo mínimo: nombre,
--   precio, categoría, icono y vínculo opcional al vendor que despacha.
--
--   Sprints siguientes agregarán:
--     - Foto (Supabase Storage)
--     - base_cost privado + markup → public_price calculado
--     - pricing_model (fijo / per_person / per_kg / per_night)
--     - cutoff_hours, capacity_max, cancellation_policy
--     - availability_rules (jsonb)
--     - Catálogo pre-cargado por mercado (Punta Cana, etc.)
--
-- Currency:
--   USD por default y por convención. La moneda del SaaS es USD; solo los
--   pagos al staff (PayoutsPanel) son multi-moneda. Guardamos la columna
--   currency pero con default 'USD' — ningún componente la lee dinámica.
-- ============================================================================

create table if not exists public.upsells (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,

  -- Vendor que despacha el servicio. NULL = el host lo entrega directo
  -- (ej: late checkout, welcome basket que arma el cleaner). Cuando hay
  -- vendor, on delete set null para no perder el upsell si se borra el
  -- proveedor — el host puede reasignarlo a otro o entregarlo él mismo.
  vendor_id            uuid references public.service_vendors(id) on delete set null,

  name                 text not null,
  description          text,

  -- Categoría operativa. Mantengo los 5 valores del componente actual:
  --   service     → limpieza extra, late checkout, mid-stay clean
  --   experience  → tours, excursiones, actividades
  --   transport   → shuttle PUJ, transporte interno
  --   food        → desayuno, chef privado, catering
  --   other       → suministros, equipo, miscelánea
  category             text not null default 'service'
                       check (category in ('service', 'experience', 'transport', 'food', 'other')),

  -- Lucide icon name (Sparkles, Car, UtensilsCrossed, etc.). El componente
  -- mantiene un map iconsMap → React component. Texto libre acá para que
  -- agregar un icono nuevo no requiera migración.
  icon_name            text not null default 'Sparkles',

  -- Precio público al huésped. Sprint 2 agrega base_cost + markup_percent
  -- y public_price se vuelve generated column. Por ahora un solo número.
  price                numeric(12,2) not null default 0
                       check (price >= 0),

  -- USD por default. No es multi-currency en este módulo. La columna existe
  -- por consistencia con el resto del schema (bookings, payouts, etc.) y por
  -- si en el futuro StayHost se expande a otros mercados.
  currency             text not null default 'USD',

  -- Disponibilidad de venta:
  --   is_global=true   → se vende en el Hub público a cualquier huésped
  --   is_global=false  → solo se ofrece a huéspedes de propiedades listadas
  -- linked_property_ids es jsonb (no array UUID) porque properties_scope en
  -- service_vendors usa el mismo patrón; consistencia con el resto.
  is_global            boolean not null default true,
  linked_property_ids  jsonb not null default '[]'::jsonb,

  active               boolean not null default true,

  -- Stats agregados — actualizados por trigger en la tabla de órdenes (Sprint
  -- siguiente). Por ahora arrancan en 0 y se updatean manual desde el UI.
  sales_count          integer not null default 0,
  revenue              numeric(12,2) not null default 0,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Index principal: listado por tenant filtrando por activos (caso común).
create index if not exists upsells_tenant_active_idx
  on public.upsells (tenant_id, active);

-- Filtro frecuente por categoría dentro de un tenant.
create index if not exists upsells_tenant_category_idx
  on public.upsells (tenant_id, category)
  where active = true;

-- Para joins reverse "qué upsells despacha este vendor".
create index if not exists upsells_vendor_idx
  on public.upsells (vendor_id)
  where vendor_id is not null;

-- Touch updated_at. Reutiliza el helper compartido (definido en
-- 20260420_service_vendors.sql).
drop trigger if exists upsells_touch_updated_at on public.upsells;
create trigger upsells_touch_updated_at
  before update on public.upsells
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.upsells enable row level security;

drop policy if exists upsells_select_own on public.upsells;
create policy upsells_select_own on public.upsells
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists upsells_insert_own on public.upsells;
create policy upsells_insert_own on public.upsells
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists upsells_update_own on public.upsells;
create policy upsells_update_own on public.upsells
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists upsells_delete_own on public.upsells;
create policy upsells_delete_own on public.upsells
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
