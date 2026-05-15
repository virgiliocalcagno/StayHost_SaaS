// Tipos compartidos del módulo Ventas Extras.
//
// Categoría unificada: productos (upsells) y vendors (upsell_vendors) usan
// la misma lista. Cuando se selecciona un vendor para un producto, ambos
// quedan en la misma categoría (la del vendor manda al crear) — aunque la
// BD permite que difieran (un vendor 'excursion' puede vender un producto
// 'transport' si fuera el caso, raro pero válido).

export type UpsellCategory =
  | "excursion"      // catamarán, Isla Saona, buggy, ATV, snorkel, city tour
  | "transport"      // shuttle PUJ, traslados, alquiler auto
  | "food"           // chef privado, catering, BBQ, desayuno
  | "laundry"        // lavandería, recogida y entrega domicilio
  | "spa"            // masaje in-room, manicura, peluquería, yoga
  | "concierge"      // niñera, médico, reserva restaurantes, intérprete
  | "rental"         // jet ski, bicis, carrito golf, snorkel equipo
  | "connectivity"   // SIM, eSIM, MiFi, internet móvil
  | "service"        // genéricos (clases, fotógrafo, lo no clasificable)
  | "other";         // cajón final

export const UPSELL_CATEGORY_LABELS: Record<UpsellCategory, string> = {
  excursion: "🌴 Excursiones",
  transport: "🚗 Transporte",
  food: "🍽️ Gastronomía",
  laundry: "🧺 Lavandería",
  spa: "💆 Spa / Bienestar",
  concierge: "🛎️ Concierge",
  rental: "🚲 Alquileres",
  connectivity: "📶 Conectividad (SIM/eSIM)",
  service: "🔧 Servicios",
  other: "📦 Otro",
};

// Cómo el vendor le cobra al host por cada venta del producto.
//   commission: vendor define precio público, host retiene X%
//   fixed_cost: vendor cobra X por unidad, host pone precio libre
//   flat_fee:   vendor cobra X fijo por orden (sin importar precio público)
export type VendorPricingMethod = "commission" | "fixed_cost" | "flat_fee";

export const VENDOR_PRICING_METHOD_LABELS: Record<VendorPricingMethod, string> = {
  commission: "Comisión sobre precio (%)",
  fixed_cost: "Costo fijo por unidad",
  flat_fee: "Cargo fijo por orden",
};

// Texto corto del campo de valor según el método.
export const VENDOR_PRICING_VALUE_LABEL: Record<VendorPricingMethod, string> = {
  commission: "Tu comisión (%)",
  fixed_cost: "Costo unitario (US$)",
  flat_fee: "Cargo del vendor (US$)",
};
