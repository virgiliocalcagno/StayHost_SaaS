// Helpers visuales para productos Ventas Extras.
//
// Cuando un upsell o template no tiene heroPhoto, igual se muestra un card
// "rico" usando un gradient + ícono propios de la categoría. Esto evita
// que el catálogo se vea hueco antes de que el host suba sus fotos.
//
// Las clases de Tailwind son literales (NO concatenadas con template
// strings) para que JIT las detecte en tiempo de build.

import {
  Sparkles,
  Palmtree,
  Car,
  UtensilsCrossed,
  Package,
  Store,
  Home,
  Clock,
  Bike,
  Wifi,
  Heart,
  BellRing,
  Shirt,
  Waves,
  Stethoscope,
  Baby,
  PartyPopper,
  ChefHat,
  Coffee,
  type LucideIcon,
} from "lucide-react";
import type { UpsellCategory } from "@/types/upsellShared";

// Map de iconos disponibles para el campo iconName del upsell. Si el host
// elige uno que no está acá, caemos al ícono default de la categoría.
export const UPSELL_ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Palmtree,
  Car,
  UtensilsCrossed,
  Package,
  Store,
  Home,
  Clock,
  Bike,
  Wifi,
  Heart,
  BellRing,
  Shirt,
  Waves,
  Stethoscope,
  Baby,
  PartyPopper,
  ChefHat,
  Coffee,
};

// Lista en orden de relevancia para el dropdown del editor de upsells.
export const UPSELL_ICON_OPTIONS: Array<{ name: string; label: string }> = [
  { name: "Sparkles", label: "✨ Genérico" },
  { name: "Palmtree", label: "🌴 Playa / excursión" },
  { name: "Waves", label: "🌊 Mar / agua" },
  { name: "Car", label: "🚗 Transporte" },
  { name: "UtensilsCrossed", label: "🍽️ Comida" },
  { name: "ChefHat", label: "👨‍🍳 Chef" },
  { name: "Coffee", label: "☕ Bebida" },
  { name: "Bike", label: "🚲 Bici / rental" },
  { name: "Shirt", label: "👕 Lavandería" },
  { name: "Heart", label: "💗 Spa / bienestar" },
  { name: "Wifi", label: "📶 Conectividad" },
  { name: "BellRing", label: "🛎️ Concierge" },
  { name: "Stethoscope", label: "🩺 Médico" },
  { name: "Baby", label: "👶 Niñera" },
  { name: "PartyPopper", label: "🎉 Celebración" },
  { name: "Home", label: "🏠 En propiedad" },
  { name: "Store", label: "🏬 Proveedor" },
  { name: "Package", label: "📦 Otro" },
];

interface CategoryVisual {
  gradient: string; // tailwind from-X to-Y
  iconColor: string; // tailwind text-X
  defaultIcon: LucideIcon;
}

// Paleta por categoría. Tonos pasteles para que el ícono destaque y el
// card no compita con la información de precio/descripción.
const CATEGORY_VISUAL: Record<UpsellCategory, CategoryVisual> = {
  excursion: {
    gradient: "from-cyan-50 to-sky-100",
    iconColor: "text-cyan-700",
    defaultIcon: Palmtree,
  },
  transport: {
    gradient: "from-slate-50 to-slate-200",
    iconColor: "text-slate-700",
    defaultIcon: Car,
  },
  food: {
    gradient: "from-orange-50 to-rose-100",
    iconColor: "text-orange-700",
    defaultIcon: UtensilsCrossed,
  },
  laundry: {
    gradient: "from-teal-50 to-cyan-100",
    iconColor: "text-teal-700",
    defaultIcon: Shirt,
  },
  spa: {
    gradient: "from-pink-50 to-rose-100",
    iconColor: "text-pink-700",
    defaultIcon: Heart,
  },
  concierge: {
    gradient: "from-sky-50 to-indigo-100",
    iconColor: "text-indigo-700",
    defaultIcon: BellRing,
  },
  rental: {
    gradient: "from-emerald-50 to-green-100",
    iconColor: "text-emerald-700",
    defaultIcon: Bike,
  },
  connectivity: {
    gradient: "from-violet-50 to-purple-100",
    iconColor: "text-violet-700",
    defaultIcon: Wifi,
  },
  service: {
    gradient: "from-amber-50 to-yellow-100",
    iconColor: "text-amber-700",
    defaultIcon: Sparkles,
  },
  other: {
    gradient: "from-slate-50 to-slate-100",
    iconColor: "text-slate-600",
    defaultIcon: Sparkles,
  },
};

function getVisual(category: string): CategoryVisual {
  return (
    CATEGORY_VISUAL[category as UpsellCategory] ?? CATEGORY_VISUAL.other
  );
}

export function getUpsellIcon(
  category: string,
  iconName?: string | null,
): LucideIcon {
  if (iconName && UPSELL_ICON_MAP[iconName]) return UPSELL_ICON_MAP[iconName];
  return getVisual(category).defaultIcon;
}

export function getCategoryGradient(category: string): string {
  return getVisual(category).gradient;
}

export function getCategoryIconColor(category: string): string {
  return getVisual(category).iconColor;
}

interface CategoryHeroProps {
  category: string;
  iconName?: string | null;
  /** "card" para grid de productos, "detail" para hero del modal. */
  size?: "card" | "detail" | "mini";
  className?: string;
}

// Hero sin foto. Gradient + ícono grande centrado + uno faint detrás
// para dar profundidad. Usado en:
//   - card grid del Hub público (UpsellExperiences)
//   - detail modal cuando no hay fotos
//   - dashboard card cuando heroPhoto = null
export function CategoryHero({
  category,
  iconName,
  size = "card",
  className = "",
}: CategoryHeroProps) {
  const Icon = getUpsellIcon(category, iconName);
  const gradient = getCategoryGradient(category);
  const iconColor = getCategoryIconColor(category);

  const sizeClasses =
    size === "detail"
      ? "aspect-[16/10]"
      : size === "mini"
      ? "h-full w-full"
      : "aspect-[4/3]";

  const mainSize =
    size === "detail" ? "h-24 w-24" : size === "mini" ? "h-6 w-6" : "h-16 w-16";
  const ghostSize =
    size === "detail" ? "h-56 w-56" : size === "mini" ? "h-10 w-10" : "h-36 w-36";

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${gradient} ${sizeClasses} ${className}`}
    >
      {/* Ícono fantasma de fondo — agrega profundidad sin competir. */}
      <Icon
        aria-hidden
        className={`absolute -bottom-4 -right-4 ${ghostSize} ${iconColor} opacity-10 rotate-12`}
      />
      {/* Ícono principal centrado. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className={`${mainSize} ${iconColor} opacity-70`} />
      </div>
    </div>
  );
}
