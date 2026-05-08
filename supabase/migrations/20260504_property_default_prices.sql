-- Sprint C — defaults canónicos de precio por propiedad.
--
-- Antes: properties.cleaner_payout (nombre ambiguo — parecía propiedad de la
-- tarea). Ahora pasa a default_cleaner_payout y se suman default_client_price
-- (lo que cobra al dueño) y default_supervisor_payout (lo que paga al
-- supervisor del equipo si es contractor).
--
-- La tarea individual (cleaning_tasks) lleva sus propios client_price,
-- cleaner_payout, supervisor_payout que pueden override estos defaults.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name = 'cleaner_payout'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name = 'default_cleaner_payout'
  ) THEN
    ALTER TABLE public.properties
      RENAME COLUMN cleaner_payout TO default_cleaner_payout;
  END IF;
END $$;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS default_cleaner_payout numeric(10,2);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS default_client_price numeric(10,2);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS default_supervisor_payout numeric(10,2);

COMMENT ON COLUMN public.properties.default_cleaner_payout IS
  'Default lo que la empresa paga al cleaner por una limpieza en esta propiedad. NULL = no configurado.';
COMMENT ON COLUMN public.properties.default_client_price IS
  'Default lo que la empresa cobra al dueño/cliente por una limpieza en esta propiedad.';
COMMENT ON COLUMN public.properties.default_supervisor_payout IS
  'Default lo que la empresa paga al supervisor por la limpieza (solo contractor). NULL = el supervisor no cobra extra.';
