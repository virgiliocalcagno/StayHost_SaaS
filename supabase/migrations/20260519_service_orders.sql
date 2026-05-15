-- ============================================================================
-- StayHost — service_orders + service_order_items (Sprint 3 Fase B.1)
-- Date: 2026-05-15
--
-- Mismo contenido aplicado vía MCP. Ver headline en route migration.
-- ============================================================================

create table if not exists public.service_orders (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  guest_name          text not null,
  guest_email         text,
  guest_phone         text,
  status              text not null default 'pending'
                      check (status in ('pending','paid','completed','cancelled','refunded')),
  total_amount        numeric(12,2) not null check (total_amount >= 0),
  currency            text not null default 'USD',
  payment_provider    text,
  payment_id          text,
  paid_at             timestamptz,
  customer_token      uuid not null default gen_random_uuid() unique,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists service_orders_tenant_idx
  on public.service_orders (tenant_id, status, created_at desc);
create index if not exists service_orders_token_idx
  on public.service_orders (customer_token);

create table if not exists public.service_order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.service_orders(id) on delete cascade,
  upsell_id           uuid references public.upsells(id) on delete set null,
  vendor_id           uuid references public.upsell_vendors(id) on delete set null,
  name                text not null,
  pricing_model       text not null
                      check (pricing_model in ('fixed','per_person','per_unit','per_kg','per_night')),
  unit_price          numeric(12,2) not null check (unit_price >= 0),
  quantity            integer not null check (quantity > 0),
  service_date        date,
  line_total          numeric(12,2) not null check (line_total >= 0),
  created_at          timestamptz not null default now()
);

create index if not exists service_order_items_order_idx
  on public.service_order_items (order_id);
create index if not exists service_order_items_upsell_idx
  on public.service_order_items (upsell_id)
  where upsell_id is not null;

drop trigger if exists service_orders_touch_updated_at on public.service_orders;
create trigger service_orders_touch_updated_at
  before update on public.service_orders
  for each row execute function public.touch_updated_at();

alter table public.service_orders enable row level security;

drop policy if exists service_orders_select_own on public.service_orders;
create policy service_orders_select_own on public.service_orders
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists service_orders_update_own on public.service_orders;
create policy service_orders_update_own on public.service_orders
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists service_orders_insert_own on public.service_orders;
create policy service_orders_insert_own on public.service_orders
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists service_orders_delete_own on public.service_orders;
create policy service_orders_delete_own on public.service_orders
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

alter table public.service_order_items enable row level security;

drop policy if exists service_order_items_select_own on public.service_order_items;
create policy service_order_items_select_own on public.service_order_items
  for select to authenticated
  using (order_id in (
    select id from public.service_orders where tenant_id = public.current_tenant_id()
  ));

drop policy if exists service_order_items_update_own on public.service_order_items;
create policy service_order_items_update_own on public.service_order_items
  for update to authenticated
  using (order_id in (
    select id from public.service_orders where tenant_id = public.current_tenant_id()
  ))
  with check (order_id in (
    select id from public.service_orders where tenant_id = public.current_tenant_id()
  ));

drop policy if exists service_order_items_insert_own on public.service_order_items;
create policy service_order_items_insert_own on public.service_order_items
  for insert to authenticated
  with check (order_id in (
    select id from public.service_orders where tenant_id = public.current_tenant_id()
  ));

drop policy if exists service_order_items_delete_own on public.service_order_items;
create policy service_order_items_delete_own on public.service_order_items
  for delete to authenticated
  using (order_id in (
    select id from public.service_orders where tenant_id = public.current_tenant_id()
  ));
