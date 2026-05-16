-- ============================================================================
-- StayHost — Sprint 1.5b: taxonomía unificada + 3 modelos de pricing del vendor
-- Date: 2026-05-15
--
-- Why:
--   1) Productos y vendors tenían dos listas de category distintas y
--      desalineadas. Unificamos a una sola taxonomía de 10 valores que
--      cubre el dominio real del SaaS en Punta Cana:
--        excursion, transport, food, laundry, spa, concierge,
--        rental, connectivity (SIM/eSIM/internet), service, other
--
--   2) El vendor antes solo soportaba "comisión %". La realidad LATAM
--      tiene 3 modelos comerciales:
--        - commission: vendor define precio, host retiene %
--        - fixed_cost: vendor te lo vende a X mayorista, host pone precio
--        - flat_fee:   vendor cobra X por orden sin importar precio público
--
--      El vendor declara su política DEFAULT, pero cada producto puede
--      override los valores específicos (mismo vendor, distinto trato
--      por producto — ej catamarán 20%, buggy costo fijo).
-- ============================================================================

-- ── 1. Taxonomía unificada ───────────────────────────────────────────────────
alter table public.upsells drop constraint if exists upsells_category_check;
alter table public.upsells
  add constraint upsells_category_check
  check (category in (
    'excursion','transport','food','laundry','spa','concierge',
    'rental','connectivity','service','other'
  ));

-- Default sigue siendo 'service' (cajón genérico, válido en la nueva lista).
alter table public.upsells alter column category set default 'service';

alter table public.upsell_vendors drop constraint if exists upsell_vendors_category_check;
alter table public.upsell_vendors
  add constraint upsell_vendors_category_check
  check (category in (
    'excursion','transport','food','laundry','spa','concierge',
    'rental','connectivity','service','other'
  ));

-- ── 2. Vendor: pricing_method por defecto + valores ──────────────────────────
-- commission_percent EXISTENTE se usa como default cuando method='commission'.
alter table public.upsell_vendors
  add column if not exists default_pricing_method text not null default 'commission'
    check (default_pricing_method in ('commission','fixed_cost','flat_fee'));

-- Lo que el vendor te cobra por unidad cuando method='fixed_cost'. El host
-- decide el precio público; su margen = precio_publico − default_fixed_cost.
alter table public.upsell_vendors
  add column if not exists default_fixed_cost numeric(12,2)
    check (default_fixed_cost is null or default_fixed_cost >= 0);

-- Lo que el vendor cobra por ORDEN (no por unidad) cuando method='flat_fee'.
-- Útil para servicios donde el costo del vendor es flat: limpieza extra
-- "cobro 30 sin importar cuánto te paguen", médico domicilio "cobro 80".
alter table public.upsell_vendors
  add column if not exists default_flat_fee numeric(12,2)
    check (default_flat_fee is null or default_flat_fee >= 0);

-- ── 3. Producto: overrides opcionales del trato con el vendor ────────────────
-- Si los 4 son null, el producto hereda los defaults del vendor. Si alguno
-- está seteado, override de ese campo. Esto permite que el mismo vendor
-- tenga 20% en catamarán pero costo fijo en buggy.
alter table public.upsells
  add column if not exists vendor_pricing_method text
    check (vendor_pricing_method is null or vendor_pricing_method in (
      'commission','fixed_cost','flat_fee'
    ));

alter table public.upsells
  add column if not exists vendor_cost numeric(12,2)
    check (vendor_cost is null or vendor_cost >= 0);

alter table public.upsells
  add column if not exists vendor_commission_percent numeric(5,2)
    check (vendor_commission_percent is null or (
      vendor_commission_percent >= 0 and vendor_commission_percent <= 100
    ));

alter table public.upsells
  add column if not exists vendor_flat_fee numeric(12,2)
    check (vendor_flat_fee is null or vendor_flat_fee >= 0);
