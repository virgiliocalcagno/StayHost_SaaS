-- ============================================================================
-- StayHost — Sprint 8d: contactos operativos por módulo (escalable)
-- Date: 2026-06-02
--
-- Why:
--   Sprint 8c (PR #46) agregó shop_contact_* a tenants. Pero el patrón se
--   repite para CADA módulo del SaaS: limpieza, check-in, mantenimiento,
--   reservas. Agregar columnas por cada módulo se vuelve insostenible y
--   ensucia la tabla `tenants`.
--
--   Solución: tabla genérica con (tenant_id, module) unique. Cada host
--   configura encargados por módulo. Helper único centraliza el fallback
--   al owner si el módulo no tiene encargado asignado.
--
--   Migramos los shop_contact_* a la tabla nueva y los dropeamos.
-- ============================================================================

create table if not exists public.tenant_module_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module      text not null
              check (module in ('shop','cleaning','checkin','maintenance','reservations','support')),
  name        text,
  email       text,
  whatsapp    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, module)
);

comment on table public.tenant_module_contacts is
  'Encargado operativo por módulo del SaaS. Si no hay row para un (tenant, module), las notifs caen al owner del tenant. Permite que distintos módulos tengan distintos responsables.';

create index if not exists tenant_module_contacts_tenant_idx
  on public.tenant_module_contacts (tenant_id);

-- Touch updated_at en cada UPDATE.
drop trigger if exists tenant_module_contacts_touch on public.tenant_module_contacts;
create trigger tenant_module_contacts_touch
  before update on public.tenant_module_contacts
  for each row execute function public.touch_updated_at();

-- RLS: solo el owner/admin del tenant puede leer/escribir SUS contactos.
alter table public.tenant_module_contacts enable row level security;

drop policy if exists tenant_module_contacts_select on public.tenant_module_contacts;
create policy tenant_module_contacts_select on public.tenant_module_contacts
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_module_contacts_insert on public.tenant_module_contacts;
create policy tenant_module_contacts_insert on public.tenant_module_contacts
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists tenant_module_contacts_update on public.tenant_module_contacts;
create policy tenant_module_contacts_update on public.tenant_module_contacts
  for update using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_module_contacts_delete on public.tenant_module_contacts;
create policy tenant_module_contacts_delete on public.tenant_module_contacts
  for delete using (tenant_id = public.current_tenant_id());

-- ── Migrar shop_contact_* de tenants a tenant_module_contacts ─────────────
-- Solo migramos tenants que tengan AL MENOS uno de los 3 campos seteados.
-- Si los 3 son NULL, no creamos row vacía.
insert into public.tenant_module_contacts (tenant_id, module, name, email, whatsapp)
  select id, 'shop', shop_contact_name, shop_contact_email, shop_contact_whatsapp
  from public.tenants
  where shop_contact_name is not null
     or shop_contact_email is not null
     or shop_contact_whatsapp is not null
  on conflict (tenant_id, module) do nothing;

-- Dropear las columnas viejas (el código nuevo lee de la tabla).
alter table public.tenants
  drop column if exists shop_contact_name,
  drop column if exists shop_contact_email,
  drop column if exists shop_contact_whatsapp;
