-- Sprint C — 3 precios por tarea + currency.
--
-- Una tarea hereda al INSERT los defaults de su propiedad (vía trigger), pero
-- queda editable caso por caso (limpieza extra, deep clean, urgencia). El
-- margen de la empresa = client_price - cleaner_payout - supervisor_payout
-- se calcula en lectura, no se guarda.

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS client_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS cleaner_payout numeric(10,2),
  ADD COLUMN IF NOT EXISTS supervisor_payout numeric(10,2),
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'DOP';

COMMENT ON COLUMN public.cleaning_tasks.client_price IS
  'Lo que la empresa cobra al dueno por esta tarea. Se hereda de properties.default_client_price al INSERT, override por admin.';
COMMENT ON COLUMN public.cleaning_tasks.cleaner_payout IS
  'Lo que la empresa paga al cleaner asignado por esta tarea. Se hereda de properties.default_cleaner_payout al INSERT.';
COMMENT ON COLUMN public.cleaning_tasks.supervisor_payout IS
  'Lo que la empresa paga al supervisor (solo contractor). Se hereda de properties.default_supervisor_payout. NULL = supervisor no cobra extra.';
COMMENT ON COLUMN public.cleaning_tasks.currency IS
  'Moneda del trio de precios. Default DOP (Dominicana). Hereda de properties si existe; si no, DOP.';

-- Trigger: al crear una tarea, hereda los precios + moneda de la propiedad si
-- el INSERT no los especificó. Si la propiedad no tiene defaults, deja NULL.
CREATE OR REPLACE FUNCTION public.cleaning_tasks_inherit_property_defaults()
RETURNS trigger AS $$
DECLARE
  prop_row record;
BEGIN
  IF NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_client_price, default_cleaner_payout, default_supervisor_payout, currency
    INTO prop_row
    FROM public.properties
    WHERE id = NEW.property_id;

  IF NEW.client_price IS NULL THEN
    NEW.client_price := prop_row.default_client_price;
  END IF;
  IF NEW.cleaner_payout IS NULL THEN
    NEW.cleaner_payout := prop_row.default_cleaner_payout;
  END IF;
  IF NEW.supervisor_payout IS NULL THEN
    NEW.supervisor_payout := prop_row.default_supervisor_payout;
  END IF;
  IF NEW.currency IS NULL THEN
    NEW.currency := COALESCE(prop_row.currency, 'DOP');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleaning_tasks_inherit_defaults_trg ON public.cleaning_tasks;
CREATE TRIGGER cleaning_tasks_inherit_defaults_trg
  BEFORE INSERT ON public.cleaning_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaning_tasks_inherit_property_defaults();
