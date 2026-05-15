// Tipos del módulo Ventas Extras (UpsellsPanel + /api/upsells).
//
// Estado: Sprint 1.5b.
//   - Categoría unificada con vendors (ver upsellShared.ts)
//   - Pricing model + capacidad + cutoff (Sprint 1.5)
//   - Override del trato con el vendor por producto (Sprint 1.5b)

import type { UpsellCategory, VendorPricingMethod } from "./upsellShared";

export type { UpsellCategory };
export { UPSELL_CATEGORY_LABELS } from "./upsellShared";

// Cómo se multiplica el precio del upsell al cobrar al huésped.
//   fixed       → 1 cobro total (late checkout, decoración cumpleaños)
//   per_person  → precio × #personas (catamarán, buggy, tour)
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
  iconName: string;
  price: number;                  // precio público (lo que paga el huésped)
  currency: string;

  // Fotos (Sprint 2). hero_photo es la principal que se muestra en cards y
  // hero del detalle. gallery son fotos adicionales para el Hub público.
  heroPhoto: string | null;
  galleryPhotos: string[];

  // Pricing + capacidad
  pricingModel: PricingModel;
  minQuantity: number;
  maxQuantity: number | null;
  capacityPerSlot: number | null;
  cutoffHours: number;

  // Override del trato con el vendor (Sprint 1.5b). Si los 4 son null, el
  // producto hereda los defaults del vendor. Si alguno está seteado, ese
  // valor manda sobre el default.
  vendorPricingMethod: VendorPricingMethod | null;
  vendorCost: number | null;
  vendorCommissionPercent: number | null;
  vendorFlatFee: number | null;

  isGlobal: boolean;
  linkedPropertyIds: string[];
  active: boolean;
  salesCount: number;
  revenue: number;
  createdAt: string;
  updatedAt: string;
}

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: "Precio fijo (total)",
  per_person: "Por persona",
  per_unit: "Por unidad",
  per_kg: "Por kilo",
  per_night: "Por noche",
};

export const PRICING_MODEL_SUFFIX: Record<PricingModel, string> = {
  fixed: "",
  per_person: "persona",
  per_unit: "unidad",
  per_kg: "kg",
  per_night: "noche",
};

// Icono default por categoría — alimenta el preset al crear un upsell.
export const UPSELL_DEFAULT_ICON: Record<UpsellCategory, string> = {
  excursion: "Palmtree",
  transport: "Car",
  food: "UtensilsCrossed",
  laundry: "Package",
  spa: "Sparkles",
  concierge: "Store",
  rental: "Package",
  connectivity: "Sparkles",
  service: "Sparkles",
  other: "Store",
};
