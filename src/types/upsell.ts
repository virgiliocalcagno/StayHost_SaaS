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

export interface Upsell {
  id: string;
  vendorId: string | null;        // null = el host lo entrega directo
  name: string;
  description: string | null;
  category: UpsellCategory;
  iconName: string;               // Lucide icon (Sparkles, Car, etc.)
  price: number;                  // siempre USD por convención del SaaS
  currency: string;               // 'USD' por default — no se renderiza dinámico
  isGlobal: boolean;              // true = Hub público / false = solo propiedades vinculadas
  linkedPropertyIds: string[];    // ignorado si isGlobal=true
  active: boolean;
  salesCount: number;
  revenue: number;
  createdAt: string;
  updatedAt: string;
}

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
