-- ============================================================================
-- StayHost — actualizar icon_name de templates Punta Cana (Sprint 4 polish)
-- Date: 2026-05-21
--
-- Why:
--   El seed original usó iconos genéricos (Sparkles, Package, Palmtree) para
--   todo. Ahora que el helper `categoryVisuals` soporta una librería más
--   amplia (Bike, Wifi, Heart, ChefHat, Stethoscope, Baby, PartyPopper,
--   Waves, Shirt, Clock), cambiamos cada template a su ícono más natural.
--
--   Toca SOLO public.upsell_templates (catálogo global del SaaS). NO toca
--   public.upsells — el host puede haber editado el icono de su producto
--   importado y no queremos pisarlo.
--
--   Idempotente: cada UPDATE es por (name, market) único.
-- ============================================================================

update public.upsell_templates set icon_name = 'ChefHat'
  where market = 'punta-cana' and name = 'Chef privado — Cena';

update public.upsell_templates set icon_name = 'Clock'
  where market = 'punta-cana' and name = 'Late check-out (4 hs)';

update public.upsell_templates set icon_name = 'Shirt'
  where market = 'punta-cana' and name = 'Lavandería express';

update public.upsell_templates set icon_name = 'Waves'
  where market = 'punta-cana' and name = 'Jet ski (30 min)';

update public.upsell_templates set icon_name = 'Waves'
  where market = 'punta-cana' and name = 'Snorkel kit (día)';

update public.upsell_templates set icon_name = 'Bike'
  where market = 'punta-cana' and name = 'Bicicletas (por día)';

update public.upsell_templates set icon_name = 'Wifi'
  where market = 'punta-cana' and name = 'SIM card RD (10GB)';

update public.upsell_templates set icon_name = 'Wifi'
  where market = 'punta-cana' and name = 'eSIM 5 días';

update public.upsell_templates set icon_name = 'Heart'
  where market = 'punta-cana' and name = 'Masaje in-room';

update public.upsell_templates set icon_name = 'Baby'
  where market = 'punta-cana' and name = 'Niñera certificada';

update public.upsell_templates set icon_name = 'PartyPopper'
  where market = 'punta-cana' and name = 'Decoración cumpleaños';

update public.upsell_templates set icon_name = 'Stethoscope'
  where market = 'punta-cana' and name = 'Médico a domicilio';

update public.upsell_templates set icon_name = 'Waves'
  where market = 'punta-cana' and name = 'Tour Hoyo Azul';
