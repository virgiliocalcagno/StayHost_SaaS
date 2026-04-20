import type { MaintenanceCategory } from "./maintenance";

export type VendorType = "maintenance" | "supplies" | "services" | "utilities";

export interface ServiceVendor {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  type: VendorType;
  subcategories: string[];
  propertiesScope: "all" | string[];
  notes?: string | null;
  rating?: number | null;
  active: boolean;
  isPreferred: boolean;
  createdAt: string;
  updatedAt: string;
}

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  maintenance: "Mantenimiento",
  supplies: "Insumos",
  services: "Servicios",
  utilities: "Utilities",
};

// Subcategorías de cada tipo. El admin puede escribir libres en el futuro,
// pero arrancamos con un set sugerido para que la UI tenga autocomplete.
// Las de `maintenance` coinciden exactamente con MaintenanceCategory para
// que el matcher de tickets pueda comparar directamente.
export const VENDOR_SUBCATEGORIES: Record<VendorType, { value: string; label: string }[]> = {
  maintenance: [
    { value: "plumbing", label: "Plomería" },
    { value: "electrical", label: "Electricidad" },
    { value: "appliance", label: "Electrodomésticos" },
    { value: "furniture", label: "Mobiliario" },
    { value: "structural", label: "Estructura/Obra" },
    { value: "cleaning_supply", label: "Insumo limpieza" },
    { value: "other", label: "Otro" },
  ],
  supplies: [
    { value: "linens", label: "Lencería/Sábanas" },
    { value: "cleaning_products", label: "Productos limpieza" },
    { value: "paper_goods", label: "Papel/consumibles" },
    { value: "amenities", label: "Amenities huésped" },
    { value: "kitchen", label: "Cocina/menaje" },
    { value: "other", label: "Otro" },
  ],
  services: [
    { value: "accounting", label: "Contador" },
    { value: "legal", label: "Abogado" },
    { value: "photography", label: "Fotógrafo" },
    { value: "design", label: "Diseño/Staging" },
    { value: "marketing", label: "Marketing" },
    { value: "insurance", label: "Seguros" },
    { value: "other", label: "Otro" },
  ],
  utilities: [
    { value: "water", label: "Agua" },
    { value: "electricity", label: "Electricidad (compañía)" },
    { value: "gas", label: "Gas" },
    { value: "internet", label: "Internet" },
    { value: "waste", label: "Basura/Aseo municipal" },
    { value: "other", label: "Otro" },
  ],
};

// Helper: dada una categoría de ticket de mantenimiento, devuelve la lista de
// vendors que pueden atenderla. Un vendor matchea si es tipo=maintenance y su
// array de subcategories contiene la categoría del ticket (o si no tiene
// subcategorías, se asume "todas" para no dejar tickets sin candidato).
export function matchesMaintenanceCategory(
  vendor: ServiceVendor,
  category: MaintenanceCategory
): boolean {
  if (vendor.type !== "maintenance" || !vendor.active) return false;
  if (!vendor.subcategories || vendor.subcategories.length === 0) return true;
  return vendor.subcategories.includes(category);
}

// Helper: alcance por propiedad. Devuelve true si el vendor cubre esta propiedad.
export function coversProperty(vendor: ServiceVendor, propertyId: string): boolean {
  if (vendor.propertiesScope === "all") return true;
  if (Array.isArray(vendor.propertiesScope)) {
    return vendor.propertiesScope.includes(propertyId);
  }
  return false;
}
