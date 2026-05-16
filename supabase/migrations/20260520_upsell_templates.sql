-- ============================================================================
-- StayHost — upsell_templates: catálogo curado global (Sprint 4)
-- Date: 2026-05-15
--
-- Why:
--   Cold-start del host nuevo: armar 20 productos a mano es 2 horas
--   perdidas. Esta tabla guarda templates curados por mercado que
--   cualquier host clona con 1 click.
--
--   Schema sin tenant_id (templates son globales). Cuando el host hace
--   "Importar", el endpoint inserta un row en `upsells` con tenant_id
--   suyo + los valores del template como starting point.
-- ============================================================================

create table if not exists public.upsell_templates (
  id                  uuid primary key default gen_random_uuid(),
  -- Idempotency key: (name, market) único para que el seed se pueda
  -- re-correr sin duplicar y permite ambientes frescos repobllar el
  -- catálogo con ON CONFLICT DO NOTHING.

  name                text not null,
  description         text,
  category            text not null
                      check (category in (
                        'excursion','transport','food','laundry','spa','concierge',
                        'rental','connectivity','service','other'
                      )),
  icon_name           text not null default 'Sparkles',
  hero_photo          text,

  suggested_price     numeric(12,2) not null check (suggested_price > 0),
  currency            text not null default 'USD',
  pricing_model       text not null
                      check (pricing_model in (
                        'fixed','per_person','per_unit','per_kg','per_night'
                      )),

  min_quantity        integer not null default 1 check (min_quantity > 0),
  max_quantity        integer check (max_quantity is null or max_quantity > 0),
  capacity_per_slot   integer check (capacity_per_slot is null or capacity_per_slot > 0),
  cutoff_hours        integer not null default 0 check (cutoff_hours >= 0),

  market              text not null default 'punta-cana',
  popularity_rank     integer not null default 100,
  active              boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists upsell_templates_market_idx
  on public.upsell_templates (market, active, popularity_rank);

create index if not exists upsell_templates_category_idx
  on public.upsell_templates (category, market)
  where active = true;

drop trigger if exists upsell_templates_touch on public.upsell_templates;
create trigger upsell_templates_touch
  before update on public.upsell_templates
  for each row execute function public.touch_updated_at();

alter table public.upsell_templates enable row level security;

-- Lectura para cualquier authenticated. INSERT/UPDATE/DELETE NO desde la
-- app — el master del SaaS los carga manualmente (este sprint ya seedeó
-- 20 templates Punta Cana via SQL directo, se omite el INSERT de esos en
-- la migración para no duplicar en re-run).
drop policy if exists upsell_templates_select_all on public.upsell_templates;
create policy upsell_templates_select_all on public.upsell_templates
  for select to authenticated
  using (active = true);

-- Restringir grants: anon NO debe tener acceso a esta tabla aunque RLS
-- bloquee. Reduce superficie de ataque acumulada.
revoke all on public.upsell_templates from anon;
revoke insert, update, delete on public.upsell_templates from authenticated;
grant select on public.upsell_templates to authenticated;

-- Unique (name, market) para que el seed sea idempotente y se pueda
-- re-correr en ambientes frescos sin duplicar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'upsell_templates_name_market_unique'
  ) then
    alter table public.upsell_templates
      add constraint upsell_templates_name_market_unique unique (name, market);
  end if;
end $$;

-- ── Seed 20 templates Punta Cana ─────────────────────────────────────────────
-- ON CONFLICT (name, market) DO NOTHING — ambiente fresco lo crea todo,
-- ambiente con datos previos no duplica.
insert into public.upsell_templates
  (name, description, category, icon_name, hero_photo, suggested_price, currency, pricing_model, min_quantity, max_quantity, capacity_per_slot, cutoff_hours, market, popularity_rank)
values
  ('Catamarán Bávaro Beach',  'Tour de medio día en catamarán por la costa de Bávaro. Incluye snorkel, piscina natural y bebidas a bordo.',  'excursion',  'Palmtree',  null,  85,  'USD',  'per_person',  2,  30,  30,  24,  'punta-cana',  10),
  ('Excursión Isla Saona',     'Día completo en Isla Saona — playa, piscina natural y almuerzo buffet.',  'excursion',  'Palmtree',  null,  90,  'USD',  'per_person',  2,  null,  40,  24,  'punta-cana',  20),
  ('Buggy/ATV Macao',          'Aventura en buggy 2 plazas por los cocoteros y playa Macao. 3 horas con guía.',  'excursion',  'Palmtree',  null,  65,  'USD',  'per_person',  1,  8,  12,  24,  'punta-cana',  30),
  ('Tour Hoyo Azul',           'Cenote natural en Scape Park + zipline opcional.',  'excursion',  'Palmtree',  null,  95,  'USD',  'per_person',  1,  null,  20,  24,  'punta-cana',  40),
  ('Shuttle Aeropuerto PUJ',   'Transporte privado aeropuerto PUJ ↔ propiedad. Vehículo con A/C, máximo 4 pasajeros.',  'transport',  'Car',  null,  35,  'USD',  'per_unit',  1,  3,  null,  6,  'punta-cana',  15),
  ('City Tour Santo Domingo',  'Día completo: Zona Colonial, almuerzo típico y compras. Guía bilingüe.',  'excursion',  'Palmtree',  null,  120,  'USD',  'per_person',  2,  null,  15,  24,  'punta-cana',  50),
  ('Chef privado — Cena',      'Cena gourmet en tu propiedad. Chef + mesero. Menú 3 tiempos con maridaje opcional.',  'food',  'UtensilsCrossed',  null,  55,  'USD',  'per_person',  2,  10,  null,  24,  'punta-cana',  35),
  ('Welcome basket',           'Canasta de bienvenida: frutas tropicales, ron Brugal, agua, snacks locales.',  'service',  'Sparkles',  null,  45,  'USD',  'fixed',  1,  null,  null,  6,  'punta-cana',  25),
  ('Late check-out (4 hs)',    'Salida hasta las 16:00. Sujeto a disponibilidad de la propiedad.',  'service',  'Sparkles',  null,  30,  'USD',  'fixed',  1,  null,  null,  0,  'punta-cana',  5),
  ('Limpieza mid-stay',        'Limpieza completa entre días de estadía larga. Cambio de toallas y sábanas incluido.',  'service',  'Sparkles',  null,  40,  'USD',  'fixed',  1,  null,  null,  12,  'punta-cana',  45),
  ('Lavandería express',       'Lavado y secado en 24h. Recogida y entrega a domicilio.',  'laundry',  'Package',  null,  6,  'USD',  'per_kg',  1,  null,  null,  2,  'punta-cana',  55),
  ('Jet ski (30 min)',         'Jet ski biplaza por 30 min con instructor en costa.',  'rental',  'Package',  null,  80,  'USD',  'per_unit',  1,  3,  null,  12,  'punta-cana',  60),
  ('Snorkel kit (día)',        'Máscara + snorkel + aletas. Retiro en propiedad, devolución al fin del día.',  'rental',  'Package',  null,  12,  'USD',  'fixed',  1,  null,  null,  4,  'punta-cana',  70),
  ('Bicicletas (por día)',     'Bici de paseo, casco incluido. Entrega y retiro en propiedad.',  'rental',  'Package',  null,  10,  'USD',  'per_night',  1,  null,  null,  4,  'punta-cana',  75),
  ('SIM card RD (10GB)',       'Tarjeta SIM Claro o Altice con 10GB y llamadas locales. Activación al check-in.',  'connectivity',  'Sparkles',  null,  25,  'USD',  'fixed',  1,  null,  null,  6,  'punta-cana',  80),
  ('eSIM 5 días',              'eSIM digital, activación inmediata por código QR. 5 días, 5GB.',  'connectivity',  'Sparkles',  null,  20,  'USD',  'fixed',  1,  null,  null,  0,  'punta-cana',  85),
  ('Masaje in-room',           'Masaje relajante 60 min en tu propiedad. Aceites incluidos.',  'spa',  'Sparkles',  null,  75,  'USD',  'per_person',  1,  4,  null,  6,  'punta-cana',  65),
  ('Niñera certificada',       'Niñera bilingüe con experiencia. 4 horas mínimo.',  'concierge',  'Store',  null,  60,  'USD',  'fixed',  1,  null,  null,  12,  'punta-cana',  90),
  ('Decoración cumpleaños',    'Decoración con globos, mensaje personalizado y torta. Foto incluida.',  'service',  'Sparkles',  null,  85,  'USD',  'fixed',  1,  null,  null,  24,  'punta-cana',  100),
  ('Médico a domicilio',       'Consulta médica en tu propiedad. Disponible 24/7. Pago al servicio.',  'concierge',  'Store',  null,  100,  'USD',  'fixed',  1,  null,  null,  0,  'punta-cana',  95)
on conflict (name, market) do nothing;
