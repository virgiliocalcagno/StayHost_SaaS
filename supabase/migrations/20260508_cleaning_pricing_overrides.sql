-- Sprint Tarifas: matriz propiedad × miembro × rol.
--
-- properties.default_cleaner_payout / default_supervisor_payout son los
-- defaults globales por propiedad. Esta tabla deja override por miembro,
-- para casos como "Sofia cobra 2500 en G44 pero Helen cobra 3000 limpiando
-- la misma propiedad". Aplica al INSERT de cleaning_tasks vía trigger.

CREATE TABLE IF NOT EXISTS public.cleaning_pricing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('cleaner', 'supervisor')),
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'DOP',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, member_id, role)
);

CREATE INDEX IF NOT EXISTS cleaning_pricing_overrides_tenant_idx
  ON public.cleaning_pricing_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS cleaning_pricing_overrides_property_idx
  ON public.cleaning_pricing_overrides (property_id);
CREATE INDEX IF NOT EXISTS cleaning_pricing_overrides_member_idx
  ON public.cleaning_pricing_overrides (member_id);

-- Touch updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.cleaning_pricing_overrides_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleaning_pricing_overrides_touch_trg
  ON public.cleaning_pricing_overrides;
CREATE TRIGGER cleaning_pricing_overrides_touch_trg
  BEFORE UPDATE ON public.cleaning_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION public.cleaning_pricing_overrides_touch();

-- RLS: aislamiento por tenant usando el helper canónico current_tenant_id().
ALTER TABLE public.cleaning_pricing_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_overrides_tenant_select ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_tenant_select ON public.cleaning_pricing_overrides
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS pricing_overrides_tenant_insert ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_tenant_insert ON public.cleaning_pricing_overrides
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS pricing_overrides_tenant_update ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_tenant_update ON public.cleaning_pricing_overrides
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS pricing_overrides_tenant_delete ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_tenant_delete ON public.cleaning_pricing_overrides
  FOR DELETE USING (tenant_id = public.current_tenant_id());

-- Trigger de cleaning_tasks: ahora consulta overrides antes de defaults.
-- Resolución para cleaner_payout:
--   1. Si NEW.cleaner_payout viene seteado en el INSERT, respetarlo.
--   2. Si hay override (property, assignee, 'cleaner'), usar ese amount.
--   3. Si no, usar properties.default_cleaner_payout.
-- Resolución para supervisor_payout (solo si la propiedad tiene supervisor_id):
--   1. Si NEW.supervisor_payout seteado, respetarlo.
--   2. Si hay override (property, supervisor_id, 'supervisor'), usar ese.
--   3. Si no, usar properties.default_supervisor_payout.
CREATE OR REPLACE FUNCTION public.cleaning_tasks_inherit_property_defaults()
RETURNS trigger AS $$
DECLARE
  prop_row record;
  override_amount numeric(10,2);
BEGIN
  IF NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_client_price, default_cleaner_payout, default_supervisor_payout, currency, supervisor_id
    INTO prop_row
    FROM public.properties
    WHERE id = NEW.property_id;

  IF NEW.client_price IS NULL THEN
    NEW.client_price := prop_row.default_client_price;
  END IF;

  IF NEW.cleaner_payout IS NULL AND NEW.assignee_id IS NOT NULL THEN
    SELECT amount INTO override_amount
      FROM public.cleaning_pricing_overrides
      WHERE property_id = NEW.property_id
        AND member_id = NEW.assignee_id
        AND role = 'cleaner'
      LIMIT 1;
    IF override_amount IS NOT NULL THEN
      NEW.cleaner_payout := override_amount;
    ELSE
      NEW.cleaner_payout := prop_row.default_cleaner_payout;
    END IF;
  ELSIF NEW.cleaner_payout IS NULL THEN
    NEW.cleaner_payout := prop_row.default_cleaner_payout;
  END IF;

  IF NEW.supervisor_payout IS NULL AND prop_row.supervisor_id IS NOT NULL THEN
    SELECT amount INTO override_amount
      FROM public.cleaning_pricing_overrides
      WHERE property_id = NEW.property_id
        AND member_id = prop_row.supervisor_id
        AND role = 'supervisor'
      LIMIT 1;
    IF override_amount IS NOT NULL THEN
      NEW.supervisor_payout := override_amount;
    ELSE
      NEW.supervisor_payout := prop_row.default_supervisor_payout;
    END IF;
  ELSIF NEW.supervisor_payout IS NULL THEN
    NEW.supervisor_payout := prop_row.default_supervisor_payout;
  END IF;

  IF NEW.currency IS NULL THEN
    NEW.currency := COALESCE(prop_row.currency, 'DOP');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
