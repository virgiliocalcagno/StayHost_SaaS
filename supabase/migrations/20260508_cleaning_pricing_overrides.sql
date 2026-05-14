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

-- RLS: SELECT abre al tenant entero (cleaner puede ver su propia fila —
-- útil para mostrarle "tu tarifa es X en esta propiedad" en el futuro).
-- INSERT/UPDATE/DELETE: SOLO el dueño del tenant (tenants.user_id = auth.uid()).
-- Sin esto, un cleaner con sesión podría golpear la REST API directo y
-- ponerse 999.999 DOP de tarifa — el endpoint del owner no es la única
-- puerta, RLS también tiene que blindarlo.
ALTER TABLE public.cleaning_pricing_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_overrides_tenant_select ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_tenant_select ON public.cleaning_pricing_overrides
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS pricing_overrides_owner_insert ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_owner_insert ON public.cleaning_pricing_overrides
  FOR INSERT WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = tenant_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pricing_overrides_owner_update ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_owner_update ON public.cleaning_pricing_overrides
  FOR UPDATE USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = tenant_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = tenant_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pricing_overrides_owner_delete ON public.cleaning_pricing_overrides;
CREATE POLICY pricing_overrides_owner_delete ON public.cleaning_pricing_overrides
  FOR DELETE USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = tenant_id AND t.user_id = auth.uid()
    )
  );

-- Backwards-compat con la primera versión que creó policies *_tenant_*:
DROP POLICY IF EXISTS pricing_overrides_tenant_insert ON public.cleaning_pricing_overrides;
DROP POLICY IF EXISTS pricing_overrides_tenant_update ON public.cleaning_pricing_overrides;
DROP POLICY IF EXISTS pricing_overrides_tenant_delete ON public.cleaning_pricing_overrides;

-- Trigger de cleaning_tasks: ahora consulta overrides antes de defaults.
-- Resolución para cleaner_payout: NEW (si vino) → override(property, assignee, cleaner) → property.default.
-- Resolución para supervisor_payout: NEW (si vino) → override(property, supervisor, supervisor) → property.default.
CREATE OR REPLACE FUNCTION public.cleaning_tasks_inherit_property_defaults()
RETURNS trigger AS $$
DECLARE
  prop_row record;
  cleaner_override numeric(10,2);
  supervisor_override numeric(10,2);
BEGIN
  IF NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_client_price, default_cleaner_payout, default_supervisor_payout, currency, supervisor_id
    INTO prop_row
    FROM public.properties
    WHERE id = NEW.property_id;

  IF NEW.assignee_id IS NOT NULL THEN
    SELECT amount INTO cleaner_override
      FROM public.cleaning_pricing_overrides
      WHERE property_id = NEW.property_id
        AND member_id = NEW.assignee_id
        AND role = 'cleaner'
      LIMIT 1;
  END IF;

  IF prop_row.supervisor_id IS NOT NULL THEN
    SELECT amount INTO supervisor_override
      FROM public.cleaning_pricing_overrides
      WHERE property_id = NEW.property_id
        AND member_id = prop_row.supervisor_id
        AND role = 'supervisor'
      LIMIT 1;
  END IF;

  NEW.client_price := COALESCE(NEW.client_price, prop_row.default_client_price);
  NEW.cleaner_payout := COALESCE(NEW.cleaner_payout, cleaner_override, prop_row.default_cleaner_payout);
  NEW.supervisor_payout := COALESCE(NEW.supervisor_payout, supervisor_override, prop_row.default_supervisor_payout);
  NEW.currency := COALESCE(NEW.currency, prop_row.currency, 'DOP');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
