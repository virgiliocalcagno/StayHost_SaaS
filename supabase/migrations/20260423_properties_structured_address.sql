-- ============================================================================
-- StayHost — direccion estructurada en properties
-- Date: 2026-04-23
--
-- El host necesita ingresar la direccion en campos separados (como Airbnb)
-- para que el gafete del huesped muestre la direccion formateada y el link
-- de Google Maps apunte exactamente al edificio/apto correcto.
--
-- Campos nuevos:
--   address_unit  — Apartamento, piso, edificio (ej: "Edificio 3 Apt 3C1")
--   neighborhood  — Distrito/vecindario (ej: "Bavaro")
--   postal_code   — Codigo postal (ej: "23000")
--
-- Los campos existentes `address` (calle y numero) y `city` se mantienen.
-- Idempotente.
-- ============================================================================

alter table public.properties
  add column if not exists address_unit text,
  add column if not exists neighborhood text,
  add column if not exists postal_code text;
