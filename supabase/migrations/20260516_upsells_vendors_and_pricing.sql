-- ============================================================================
-- StayHost — Sprint 1.5: separar vendors de tienda + pricing_model en upsells
-- Date: 2026-05-15
--
-- Why:
--   La tabla service_vendors está pensada para proveedores operativos del host
--   (plomero, electricista, contador, internet). Mezclar ahí los proveedores
--   de la tienda de Ventas Extras (capitán de catamarán, conductor PUJ, spa,
--   chef privado) es semánticamente incorrecto:
--     - Datos distintos: comisión%, contrato, marca pública, foto del capitán.
--     - Privacidad distinta: el huésped ve al capitán, NO al plomero.
--     - Pagos distintos: vendor de tienda cobra por reserva con comisión;
--       el plomero factura único.
--
--   Esta migración:
--     1) Crea upsell_vendors (tienda) — separado de service_vendors (operativo).
--     2) Agrega pricing_model + min/max_quantity + capacity_per_slot +
--        cutoff_hours a upsells. Sin esto no se puede vender excursión
--        "por persona" — solo precios fijos.
--     3) Rebuild FK de upsells.vendor_id → upsell_vendors (no hay datos
--        vendor_id != null en producción al momento de la migración).
-- ============================================================================

-- ── 1. upsell_vendors ────────────────────────────────────────────────────────
create table if not exists public.upsell_vendors (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,

  -- Identidad. `name` es interno del host; `display_name` (opcional) es la
  -- marca que se muestra al huésped en el Hub — si null, usa `name`.
  name                    text not null,
  contact_name            text,
  phone                   text,
  email                   text,
  rnc_cedula              text,

  -- Categoría del core business del vendor. Un vendor puede vender distintos
  -- upsells dentro de su categoría (Bávaro Tours hace catamarán + buggy +
  -- snorkel, todos 'excursion'). NO se reutiliza la category del upsell.
  category                text not null default 'other'
                          check (category in (
                            'excursion','transport','food','laundry',
                            'spa','concierge','other'
                          )),

  -- Cara pública (lo que ve el huésped en el Hub público).
  display_name            text,
  hero_photo              text,
  description             text,
  languages               jsonb not null default '[]'::jsonb,

  -- Comercial. commission_percent = % del precio público que retiene el host;
  -- el vendor recibe (100 - commission_percent)%. payment_terms define
  -- cuándo se le paga (on_completion / pre_paid / split).
  commission_percent      numeric(5,2) not null default 0
                          check (commission_percent >= 0 and commission_percent <= 100),
  payment_terms           text not null default 'on_completion'
                          check (payment_terms in ('on_completion','pre_paid','split')),

  -- Contrato digital (Sprint 5). Snapshot inmutable + nombre y cédula del
  -- firmante. Por ahora nullable; cuando se implemente el flow se valida
  -- not null antes de permitir crear órdenes con ese vendor.
  agreement_accepted_at   timestamptz,
  agreement_version       text,
  agreement_pdf_path      text,
  accepted_by_name        text,
  accepted_by_id_doc      text,

  -- Operativo.
  rating                  numeric(2,1) check (rating is null or (rating >= 1 and rating <= 5)),
  total_orders            integer not null default 0,
  active                  boolean not null default true,
  notes                   text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists upsell_vendors_tenant_active_idx
  on public.upsell_vendors (tenant_id, active);

create index if not exists upsell_vendors_category_idx
  on public.upsell_vendors (tenant_id, category)
  where active = true;

drop trigger if exists upsell_vendors_touch_updated_at on public.upsell_vendors;
create trigger upsell_vendors_touch_updated_at
  before update on public.upsell_vendors
  for each row execute function public.touch_updated_at();

-- RLS — patrón estándar del proyecto.
alter table public.upsell_vendors enable row level security;

drop policy if exists upsell_vendors_select_own on public.upsell_vendors;
create policy upsell_vendors_select_own on public.upsell_vendors
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists upsell_vendors_insert_own on public.upsell_vendors;
create policy upsell_vendors_insert_own on public.upsell_vendors
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists upsell_vendors_update_own on public.upsell_vendors;
create policy upsell_vendors_update_own on public.upsell_vendors
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists upsell_vendors_delete_own on public.upsell_vendors;
create policy upsell_vendors_delete_own on public.upsell_vendors
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

-- ── 2. Extender upsells con campos de pricing y capacidad ────────────────────
-- pricing_model define cómo se multiplica el precio:
--   fixed       → 1 cobro total (late checkout, decoración)
--   per_person  → precio × #personas (catamarán, buggy, tour)
--   per_unit    → precio × cantidad (jet ski, hora extra, prenda)
--   per_kg      → precio × kg (lavandería)
--   per_night   → precio × noches (crib, mid-stay clean recurrente)
alter table public.upsells
  add column if not exists pricing_model text not null default 'fixed'
    check (pricing_model in ('fixed','per_person','per_unit','per_kg','per_night'));

-- Límites por orden. min_quantity > 0 siempre. max_quantity null = sin tope.
alter table public.upsells
  add column if not exists min_quantity integer not null default 1
    check (min_quantity > 0);

alter table public.upsells
  add column if not exists max_quantity integer
    check (max_quantity is null or max_quantity >= 1);

-- Capacidad total por "slot" (típicamente 1 día). Null = sin límite — útil
-- para servicios que no agotan (late checkout, lavandería). El motor de
-- ventas decrementa esto contra órdenes confirmadas del día.
alter table public.upsells
  add column if not exists capacity_per_slot integer
    check (capacity_per_slot is null or capacity_per_slot > 0);

-- Hrs antes del servicio para cerrar venta. Transporte aeropuerto: 6h.
-- Catamarán: 24h. Lavandería: 2h. 0 = se puede pedir hasta el último minuto.
alter table public.upsells
  add column if not exists cutoff_hours integer not null default 0
    check (cutoff_hours >= 0);

-- Constraint cross-column: max_quantity >= min_quantity cuando ambos existen.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'upsells_quantity_range_chk'
  ) then
    alter table public.upsells
      add constraint upsells_quantity_range_chk
      check (max_quantity is null or max_quantity >= min_quantity);
  end if;
end $$;

-- ── 3. Rebuild FK upsells.vendor_id → upsell_vendors ─────────────────────────
-- Pre-condición verificada: 0 rows con vendor_id != null al momento de la
-- migración, así que el cambio de FK no genera huérfanos.
alter table public.upsells drop constraint if exists upsells_vendor_id_fkey;
alter table public.upsells
  add constraint upsells_vendor_id_fkey
  foreign key (vendor_id) references public.upsell_vendors(id) on delete set null;
