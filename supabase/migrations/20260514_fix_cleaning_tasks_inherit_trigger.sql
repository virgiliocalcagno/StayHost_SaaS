-- 2026-05-14 — Fix critico: trigger inherit_property_defaults comparaba
-- member_id (uuid) = NEW.assignee_id (text) y fallaba con "operator does not
-- exist: uuid = text" en cada INSERT con assignee. Resultado silencioso:
-- ninguna tarea creada con assignee tomaba precio del override por miembro.
--
-- Esto se descubrió aplicando el override de Helen=1000 a la tarea
-- block-802db971 — el INSERT explotaba en el trigger.
--
-- Fix: cast member_id::text en la comparación cleaner_override. El lado de
-- supervisor sí compara uuid=uuid (prop_row.supervisor_id es uuid), no
-- requiere cast.
--
-- También: SET search_path = public (cierra advisor function_search_path_mutable)
-- y SECURITY INVOKER explícito.

CREATE OR REPLACE FUNCTION public.cleaning_tasks_inherit_property_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
  DECLARE
    prop_row record;
    cleaner_override numeric(10,2);
    supervisor_override numeric(10,2);
  BEGIN
    IF NEW.property_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT default_client_price, default_cleaner_payout,
           default_supervisor_payout, currency, supervisor_id
      INTO prop_row
      FROM public.properties
      WHERE id = NEW.property_id;

    IF NEW.assignee_id IS NOT NULL THEN
      SELECT amount INTO cleaner_override
        FROM public.cleaning_pricing_overrides
        WHERE property_id = NEW.property_id
          AND member_id::text = NEW.assignee_id
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
$function$;
