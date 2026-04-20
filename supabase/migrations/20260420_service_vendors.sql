-- ============================================================================
-- StayHost — service_vendors: directorio de proveedores transversal
-- Date: 2026-04-20
--
-- Why:
--   Los tickets de mantenimiento hoy tienen un campo libre "assigneeName",
--   pero escalarlos implica que el operador recuerde a quién llamar y por
--   dónde. Además, el mismo directorio sirve para compras de insumos,
--   servicios profesionales (contador, diseñador) y utilities (agua/gas).
--
--   Esta tabla centraliza esos contactos con una taxonomía de dos niveles
--   (type + subcategories) y los vincula opcionalmente a propiedades
--   (properties_scope). Otros módulos la consumen: el panel de
--   mantenimiento para escalar por WhatsApp, y más adelante el wizard de
--   limpieza para reordenar insumos faltantes.
-- ============================================================================

create table if not exists public.service_vendors (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,

  name              text not null,
  phone             text,               -- formato E.164 idealmente: +569XXXXXXXX
  email             text,

  -- Tipo principal — define qué módulo consume este proveedor.
  type              text not null default 'maintenance'
                    check (type in ('maintenance', 'supplies', 'services', 'utilities')),

  -- Subcategorías dentro del tipo. Para 'maintenance' estas coinciden con
  -- las categorías del ticket (plumbing, electrical, etc.) así que el
  -- matcher puede comparar directamente. Para 'supplies' serían cosas
  -- como "linens", "cleaning_products", "paper_goods". Array libre para
  -- que el frontend controle la taxonomía sin requerir migración.
  subcategories     jsonb not null default '[]'::jsonb,

  -- Alcance de propiedades. 'all' = el proveedor trabaja todas las propiedades
  -- del tenant. Array = solo estas propiedades (por zona, contrato, etc.).
  properties_scope  jsonb not null default '"all"'::jsonb,

  notes             text,
  rating            numeric(2,1) check (rating is null or (rating >= 1 and rating <= 5)),
  active            boolean not null default true,

  -- Favorito por subcategoría: si dos plomeros cubren "plumbing", este flag
  -- indica cuál se selecciona por defecto. El frontend puede marcar solo uno
  -- por (tenant, subcategoría), la restricción se aplica desde el código.
  is_preferred      boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists service_vendors_tenant_idx
  on public.service_vendors (tenant_id, type, active);

create index if not exists service_vendors_active_idx
  on public.service_vendors (tenant_id, active)
  where active = true;

-- Trigger: touch updated_at. Reutiliza el helper compartido.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'touch_updated_at'
  ) then
    create or replace function public.touch_updated_at()
    returns trigger language plpgsql as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end $$;

drop trigger if exists service_vendors_touch_updated_at on public.service_vendors;
create trigger service_vendors_touch_updated_at
  before update on public.service_vendors
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.service_vendors enable row level security;

drop policy if exists service_vendors_select_own on public.service_vendors;
create policy service_vendors_select_own on public.service_vendors
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists service_vendors_insert_own on public.service_vendors;
create policy service_vendors_insert_own on public.service_vendors
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists service_vendors_update_own on public.service_vendors;
create policy service_vendors_update_own on public.service_vendors
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists service_vendors_delete_own on public.service_vendors;
create policy service_vendors_delete_own on public.service_vendors
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
