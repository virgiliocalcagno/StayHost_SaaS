-- ============================================================================
-- StayHost — properties.ical_token: garantizar que toda propiedad tenga token
-- Date: 2026-04-21
--
-- Why:
--   /api/ical/export ahora exige ?token=xxx para evitar que cualquiera con un
--   property_id pueda leer las reservas de un host. La columna ical_token ya
--   existia, pero filas viejas podian tener NULL — esas se quedaban sin URL
--   exportable. Esta migracion:
--     1. Asegura que la columna existe con default gen_random_uuid()
--     2. Backfill: asigna un token random a cualquier fila con NULL
--     3. NOT NULL para futuras inserciones
-- ============================================================================

-- 1) Asegurar columna con default
alter table public.properties
  add column if not exists ical_token text default gen_random_uuid()::text;

-- 2) Backfill — solo afecta filas que tienen NULL
update public.properties
set ical_token = gen_random_uuid()::text
where ical_token is null;

-- 3) NOT NULL para que insertions futuras siempre tengan token
alter table public.properties
  alter column ical_token set not null;

-- 4) Indice por token — el endpoint busca por (id, token) en cada fetch
--    de Airbnb (cada 2-4h por propiedad). Sin indice se hace seq scan.
create index if not exists properties_ical_token_idx
  on public.properties (id, ical_token);
