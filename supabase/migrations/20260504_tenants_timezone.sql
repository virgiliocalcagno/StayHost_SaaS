-- Sprint Z: timezone-safe display
-- Cada tenant define su zona operativa. Toda fecha visible/operativa se calcula
-- en zona del tenant, nunca del navegador ni del servidor.
-- Default America/Santo_Domingo (UTC-4 sin DST) por base inicial LATAM.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Santo_Domingo';

COMMENT ON COLUMN public.tenants.timezone IS
  'IANA tz (ej: America/Santo_Domingo, America/Mexico_City, America/Bogota). Usado por src/lib/datetime/tenant-time.ts.';
