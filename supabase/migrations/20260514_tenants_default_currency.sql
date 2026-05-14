-- 2026-05-14 — Multi-currency: default por tenant + tipo de cambio
--
-- Contexto: en Punta Cana se opera tanto en DOP como USD. Owners locales
-- cobran/pagan en DOP, owners extranjeros (Cap Cana, Bavaro) en USD. Cada
-- propiedad puede tener su propia moneda; el tenant define la moneda por
-- defecto que se usa al crear propiedades nuevas.
--
-- usd_to_local_rate: tasa manual editable por el owner. NO se usa para
-- almacenar precios — solo para conversión visual en reportes/dashboards.
-- Default 60 = aproximación realista DOP↔USD a mayo 2026.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'DOP'
    CHECK (default_currency IN ('DOP', 'USD'));

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS usd_to_local_rate numeric(8,2) DEFAULT 60.00;

-- Comentario en columna para que sea explícito en pgAdmin / dashboard.
COMMENT ON COLUMN public.tenants.default_currency IS
  'Moneda por defecto para propiedades nuevas. DOP|USD. Cada propiedad puede override.';
COMMENT ON COLUMN public.tenants.usd_to_local_rate IS
  'Tasa USD→moneda local del tenant. Se usa solo para conversión visual en reportes; no se aplica a almacenamiento de precios.';
