-- ============================================================================
-- StayHost — i18n de upsells: name/description en inglés
-- Date: 2026-05-24
--
-- Why:
--   El hub público tiene toggle ES/EN, pero hasta ahora solo cambiaba el
--   chrome (labels, navegación). Los textos del CATÁLOGO del host (nombre
--   del producto, descripción) quedaban en su idioma original — el huésped
--   inglés veía "Catamarán Bávaro Beach" con descripción en español, y la
--   tienda perdía su credibilidad bilingüe.
--
-- Approach:
--   - Agregar columnas `_en` para name y description en upsells +
--     upsell_templates. NULL = no traducido, hub hace fallback al ES.
--   - Traducir manualmente los 20 templates Punta Cana en esta misma
--     migración (curados, no auto-traducidos).
--   - Auto-traducción con Gemini Flash-Lite cuando el host edita en
--     español pero no completa el inglés — se hace en el endpoint, no acá.
-- ============================================================================

alter table public.upsells
  add column if not exists name_en        text,
  add column if not exists description_en text;

comment on column public.upsells.name_en is
  'Nombre del producto en inglés. NULL → hub hace fallback a name (ES).';
comment on column public.upsells.description_en is
  'Descripción en inglés. NULL → hub hace fallback a description (ES).';

alter table public.upsell_templates
  add column if not exists name_en        text,
  add column if not exists description_en text;

-- Traducciones manuales curadas de los 20 templates Punta Cana
update public.upsell_templates set
  name_en = 'Bávaro Beach Catamaran',
  description_en = 'Half-day catamaran tour along Bávaro coast. Includes snorkel, natural pool and onboard drinks.'
  where market = 'punta-cana' and name = 'Catamarán Bávaro Beach';

update public.upsell_templates set
  name_en = 'Saona Island Excursion',
  description_en = 'Full day on Saona Island — beach, natural pool and buffet lunch.'
  where market = 'punta-cana' and name = 'Excursión Isla Saona';

update public.upsell_templates set
  name_en = 'Macao Buggy/ATV Tour',
  description_en = 'Buggy adventure (2-seater) through coconut groves and Macao beach. 3 hours with guide.'
  where market = 'punta-cana' and name = 'Buggy/ATV Macao';

update public.upsell_templates set
  name_en = 'Hoyo Azul Cenote Tour',
  description_en = 'Natural cenote at Scape Park + optional zipline.'
  where market = 'punta-cana' and name = 'Tour Hoyo Azul';

update public.upsell_templates set
  name_en = 'PUJ Airport Shuttle',
  description_en = 'Private transport PUJ airport ↔ property. A/C vehicle, maximum 4 passengers.'
  where market = 'punta-cana' and name = 'Shuttle Aeropuerto PUJ';

update public.upsell_templates set
  name_en = 'Santo Domingo City Tour',
  description_en = 'Full day: Colonial Zone, traditional lunch and shopping. Bilingual guide.'
  where market = 'punta-cana' and name = 'City Tour Santo Domingo';

update public.upsell_templates set
  name_en = 'Private Chef — Dinner',
  description_en = 'Gourmet dinner at your property. Chef + server. 3-course menu with optional wine pairing.'
  where market = 'punta-cana' and name = 'Chef privado — Cena';

update public.upsell_templates set
  name_en = 'Welcome Basket',
  description_en = 'Welcome basket: tropical fruits, Brugal rum, water, local snacks.'
  where market = 'punta-cana' and name = 'Welcome basket';

update public.upsell_templates set
  name_en = 'Late Check-out (4 hrs)',
  description_en = 'Check-out until 4:00 PM. Subject to property availability.'
  where market = 'punta-cana' and name = 'Late check-out (4 hs)';

update public.upsell_templates set
  name_en = 'Mid-stay Cleaning',
  description_en = 'Full cleaning between days of long stay. Towels and sheets change included.'
  where market = 'punta-cana' and name = 'Limpieza mid-stay';

update public.upsell_templates set
  name_en = 'Express Laundry',
  description_en = '24-hour wash and dry. Pickup and delivery at your property.'
  where market = 'punta-cana' and name = 'Lavandería express';

update public.upsell_templates set
  name_en = 'Jet Ski (30 min)',
  description_en = '30-minute two-seater jet ski ride with instructor on the coast.'
  where market = 'punta-cana' and name = 'Jet ski (30 min)';

update public.upsell_templates set
  name_en = 'Snorkel Kit (full day)',
  description_en = 'Mask + snorkel + fins. Pickup at property, return at end of day.'
  where market = 'punta-cana' and name = 'Snorkel kit (día)';

update public.upsell_templates set
  name_en = 'Bicycles (per day)',
  description_en = 'Cruiser bike, helmet included. Delivered and picked up at your property.'
  where market = 'punta-cana' and name = 'Bicicletas (por día)';

update public.upsell_templates set
  name_en = 'DR SIM card (10GB)',
  description_en = 'Claro or Altice SIM card with 10GB and local calls. Activated at check-in.'
  where market = 'punta-cana' and name = 'SIM card RD (10GB)';

update public.upsell_templates set
  name_en = '5-day eSIM',
  description_en = 'Digital eSIM, instant activation via QR code. 5 days, 5GB.'
  where market = 'punta-cana' and name = 'eSIM 5 días';

update public.upsell_templates set
  name_en = 'In-room Massage',
  description_en = '60-minute relaxing massage at your property. Oils included.'
  where market = 'punta-cana' and name = 'Masaje in-room';

update public.upsell_templates set
  name_en = 'Certified Babysitter',
  description_en = 'Bilingual experienced babysitter. 4-hour minimum.'
  where market = 'punta-cana' and name = 'Niñera certificada';

update public.upsell_templates set
  name_en = 'Birthday Decoration',
  description_en = 'Decoration with balloons, personalized message and cake. Photo included.'
  where market = 'punta-cana' and name = 'Decoración cumpleaños';

update public.upsell_templates set
  name_en = 'House Call Doctor',
  description_en = 'Medical consultation at your property. Available 24/7. Pay on service.'
  where market = 'punta-cana' and name = 'Médico a domicilio';
