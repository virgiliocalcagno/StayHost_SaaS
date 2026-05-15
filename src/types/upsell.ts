// Tipos del módulo Ventas Extras (UpsellsPanel + /api/upsells).
//
// Estado actual: Sprint 1. Solo persistencia básica del catálogo + vínculo
// opcional al vendor que despacha. Los campos operativos avanzados
// (cutoff, capacity, cancellation_policy, pricing_model, fotos, markup
// separado) llegan en sprints siguientes — agregar acá sin romper el
// shape actual cuando corresponda.

export type UpsellCategory =
  | "service"       // late checkout, mid-stay clean, lavandería interna
  | "experience"    // tours, excursiones, actividades
  | "transport"     // shuttle aeropuerto, traslados
  | "food"          // chef privado, catering, desayuno
  | "other";        // suministros, equipo, miscelánea

// Cómo se multiplica el precio del upsell al cobrar al huésped.
//   fixed       → 1 cobro total (late checkout, decoración cumpleaños)
//   per_person  → precio × #personas (catamarán, buggy, tour Isla Saona)
//   per_unit    → precio × cantidad (jet ski, hora extra, prenda)
//   per_kg      → precio × kg (lavandería)
//   per_night   → precio × noches (crib, mid-stay clean recurrente)
export type PricingModel =
  | "fixed"
  | "per_person"
  | "per_unit"
  | "per_kg"
  | "per_night";

export interface Upsell {
  id: string;
  vendorId: string | null;        // null = el host lo entrega directo
  name: string;
  description: string | null;
  category: UpsellCategory;
  iconName: string;               // Lucide icon (Sparkles, Car, etc.)
  price: number;                  // siempre USD por convención del SaaS
  currency: string;               // 'USD' por default — no se renderiza dinámico

  // Pricing + capacidad (Sprint 1.5)
  pricingModel: PricingModel;
  minQuantity: number;            // siempre >= 1
  maxQuantity: number | null;     // null = sin tope
  capacityPerSlot: number | null; // null = sin límite de unidades por día
  cutoffHours: number;            // hrs antes del servicio para cerrar venta

  isGlobal: boolean;              // true = Hub público / false = solo propiedades vinculadas
  linkedPropertyIds: string[];    // ignorado si isGlobal=true
  active: boolean;
  salesCount: number;
  revenue: number;
  createdAt: string;
  updatedAt: string;
}

// Labels UI para el dropdown de pricing model + el sufijo del precio.
export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: "Precio fijo (total)",
  per_person: "Por persona",
  per_unit: "Por unidad",
  per_kg: "Por kilo",
  per_night: "Por noche",
};

// Sufijo corto para mostrar junto al precio. Ej: "US$ 85 / persona".
// `fixed` queda vacío — "US$ 85 / total" suena raro en español; el caller
// chequea string vacío antes de renderizar el separador.
export const PRICING_MODEL_SUFFIX: Record<PricingModel, string> = {
  fixed: "",
  per_person: "persona",
  per_unit: "unidad",
  per_kg: "kg",
  per_night: "noche",
};

export const UPSELL_CATEGORY_LABELS: Record<UpsellCategory, string> = {
  service: "🔧 Servicio",
  experience: "🌴 Experiencia",
  transport: "🚗 Transporte",
  food: "🍽️ Gastronomía",
  other: "📦 Otro",
};

// Iconos sugeridos por categoría — el UI permite cambiarlo, pero esto
// alimenta el default al crear un upsell nuevo en cada categoría.
export const UPSELL_DEFAULT_ICON: Record<UpsellCategory, string> = {
  service: "Sparkles",
  experience: "Palmtree",
  transport: "Car",
  food: "UtensilsCrossed",
  other: "Store",
};
