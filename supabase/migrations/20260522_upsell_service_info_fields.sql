-- ============================================================================
-- StayHost — campos de info del servicio en upsells y service_order_items
-- Date: 2026-05-22
--
-- Why:
--   Hasta ahora el huésped solo elegía cantidad + fecha. Para servicios
--   reales (excursiones, transport, chef, masaje) hace falta capturar
--   hora, punto de recogida, número de vuelo y notas extras al momento
--   de la compra. Sin esto el host tenía que perseguir al huésped por
--   WhatsApp post-pago para preguntar todo eso — feo y poco profesional.
--
-- Approach:
--   - Flags en `upsells` (qué pedir) → el host elige al crear/editar.
--   - Columnas data en `service_order_items` (qué se capturó).
--   - Mismos flags en `upsell_templates` → defaults inteligentes por
--     categoría / nombre, así los imports vienen pre-configurados.
--
-- Backward-compat:
--   - Flags default false → upsells existentes siguen funcionando igual.
--   - Service_order_items existentes quedan con campos en NULL.
-- ============================================================================

-- 1) Catálogo del host (upsells)
alter table public.upsells
  add column if not exists requires_time             boolean not null default false,
  add column if not exists requires_pickup_location  boolean not null default false,
  add column if not exists requires_flight_number    boolean not null default false,
  add column if not exists notes_placeholder         text;

comment on column public.upsells.requires_time is
  'Si true, el hub público pide al huésped la hora del servicio (HH:MM).';
comment on column public.upsells.requires_pickup_location is
  'Si true, el huésped indica punto de recogida (excursiones, transport).';
comment on column public.upsells.requires_flight_number is
  'Si true, el huésped ingresa número de vuelo (shuttle aeropuerto).';
comment on column public.upsells.notes_placeholder is
  'Si está seteado, aparece como placeholder en el textarea de notas extras del huésped. Si null, no se muestra el campo de notas.';

-- 2) Items capturados al hacer el pedido
alter table public.service_order_items
  add column if not exists service_time     text,
  add column if not exists pickup_location  text,
  add column if not exists flight_number    text,
  add column if not exists extra_notes      text;

comment on column public.service_order_items.service_time is
  'Hora del servicio (HH:MM o texto libre). Capturado solo si el upsell tiene requires_time=true.';
comment on column public.service_order_items.pickup_location is
  'Punto de recogida indicado por el huésped.';
comment on column public.service_order_items.flight_number is
  'Número de vuelo (ej AA1234). El host puede armar link a Google Flights con esto.';
comment on column public.service_order_items.extra_notes is
  'Notas libres del huésped (alergias, talla, etc). Capturado si el upsell tiene notes_placeholder seteado.';

-- 3) Templates globales del SaaS
alter table public.upsell_templates
  add column if not exists requires_time             boolean not null default false,
  add column if not exists requires_pickup_location  boolean not null default false,
  add column if not exists requires_flight_number    boolean not null default false,
  add column if not exists notes_placeholder         text;

-- 4) Defaults inteligentes en templates Punta Cana — solo upsell_templates,
--    NO public.upsells (esos son de cada host y puede haberlos editado).
--
--    Reglas por categoría / nombre:
--      excursion         → time + pickup
--      shuttle aeropuerto → flight + notes(pasajeros/equipaje)
--      chef privado      → time + notes(alergias/menú)
--      spa (masaje)      → time + notes(tipo/género terapeuta)
--      laundry           → time + notes(cantidad)
--      concierge niñera  → time + notes(edad niños/idioma)
--      concierge médico  → notes(síntomas)
--      rental bici/jet/snorkel → time + notes(talla/experiencia)
--      connectivity      → notes(a nombre de quién)
--      late check-out    → time
--      city tour         → time + pickup

update public.upsell_templates set
  requires_time = true,
  requires_pickup_location = true,
  notes_placeholder = 'Preferencias del grupo, alergias, idioma del guía...'
  where market = 'punta-cana' and category = 'excursion'
    and name in ('Catamarán Bávaro Beach', 'Excursión Isla Saona', 'Buggy/ATV Macao', 'Tour Hoyo Azul', 'City Tour Santo Domingo');

update public.upsell_templates set
  requires_flight_number = true,
  requires_time = true,
  notes_placeholder = '# de pasajeros, equipaje extra, asiento de bebé...'
  where market = 'punta-cana' and name = 'Shuttle Aeropuerto PUJ';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Alergias, restricciones dietéticas, preferencias de menú...'
  where market = 'punta-cana' and name = 'Chef privado — Cena';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Tipo de masaje (relajante / deportivo / pareja), género del terapeuta preferido...'
  where market = 'punta-cana' and name = 'Masaje in-room';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Cantidad aproximada de prendas, prendas delicadas...'
  where market = 'punta-cana' and name = 'Lavandería express';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Edad y cantidad de niños, idioma preferido, alergias...'
  where market = 'punta-cana' and name = 'Niñera certificada';

update public.upsell_templates set
  notes_placeholder = 'Síntomas o motivo de la consulta'
  where market = 'punta-cana' and name = 'Médico a domicilio';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Cantidad y tallas (S/M/L) — adultos y/o niños'
  where market = 'punta-cana' and name = 'Bicicletas (por día)';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Experiencia previa, peso aproximado (para chaleco)'
  where market = 'punta-cana' and name = 'Jet ski (30 min)';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Cantidad de kits y tallas de máscara'
  where market = 'punta-cana' and name = 'Snorkel kit (día)';

update public.upsell_templates set
  notes_placeholder = 'A nombre de quién se activa la línea (nombre completo)'
  where market = 'punta-cana' and name in ('SIM card RD (10GB)', 'eSIM 5 días');

update public.upsell_templates set
  requires_time = true
  where market = 'punta-cana' and name = 'Late check-out (4 hs)';

update public.upsell_templates set
  notes_placeholder = 'Preferencia de horario de entrega, alergias alimentarias'
  where market = 'punta-cana' and name = 'Welcome basket';

update public.upsell_templates set
  requires_time = true,
  notes_placeholder = 'Mensaje personalizado, colores preferidos, sabor de torta'
  where market = 'punta-cana' and name = 'Decoración cumpleaños';

update public.upsell_templates set
  requires_time = true
  where market = 'punta-cana' and name = 'Limpieza mid-stay';
