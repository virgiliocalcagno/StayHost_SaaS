"use client";

// Catálogo de templates curados Punta Cana — onboarding del host.
//
// Sprint 4: el host abre el sheet, ve 20 servicios típicos, hace click
// "Importar" en los que le sirven. Cada import crea un upsell editable
// con los valores del template como starting point.
//
// Después del import, el host puede ajustar precio/markup/vendor desde
// el form de edición normal (botón Editar en la card del producto).

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  Sparkles,
  Palmtree,
  Car,
  UtensilsCrossed,
  Package,
  Store,
  Check,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import type { UpsellCategory } from "@/types/upsellShared";
import { UPSELL_CATEGORY_LABELS } from "@/types/upsellShared";

interface Template {
  id: string;
  name: string;
  description: string | null;
  category: UpsellCategory;
  iconName: string;
  heroPhoto: string | null;
  suggestedPrice: number;
  currency: string;
  pricingModel: string;
  minQuantity: number;
  maxQuantity: number | null;
  capacityPerSlot: number | null;
  cutoffHours: number;
  market: string;
}

const iconMap: Record<string, React.ElementType> = {
  Sparkles, Palmtree, Car, UtensilsCrossed, Package, Store,
};

const PRICING_SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "persona",
  per_unit: "unidad",
  per_kg: "kg",
  per_night: "noche",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** IDs de upsells ya creados — para marcar "ya importado" en la card. Match aproximado por nombre. */
  existingNames: Set<string>;
  /** Callback cuando el host importó al menos uno — el caller refresca la lista. */
  onImported: () => void;
}

export default function UpsellTemplateCatalog({
  open,
  onOpenChange,
  existingNames,
  onImported,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<UpsellCategory | "all">("all");
  const [importing, setImporting] = useState<string | null>(null);
  // Set de templateIds ya importados en esta sesión (visual feedback).
  const [justImported, setJustImported] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/upsell-templates", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const j = (await res.json()) as { templates: Template[] };
        setTemplates(j.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Recargar cada vez que se abre el sheet — el master del SaaS puede
  // haber agregado templates entre apertura y cierre. Si fuera caro,
  // podríamos cachear con TTL, pero el endpoint es pequeño.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!t.name.toLowerCase().includes(s) && !(t.description ?? "").toLowerCase().includes(s)) {
          return false;
        }
      }
      return true;
    });
  }, [templates, categoryFilter, search]);

  const categoriesWithCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of templates) counts[t.category] = (counts[t.category] ?? 0) + 1;
    return counts;
  }, [templates]);

  const handleImport = async (template: Template) => {
    if (importing) return;
    setImporting(template.id);
    try {
      const res = await fetch("/api/upsell-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ templateId: template.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "No se pudo importar");
        return;
      }
      setJustImported((prev) => new Set(prev).add(template.id));
      onImported();
    } finally {
      setImporting(null);
    }
  };

  const getIcon = (name: string) => {
    const Icon = iconMap[name] ?? Sparkles;
    return <Icon className="h-5 w-5 text-amber-600" />;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Catálogo Punta Cana</SheetTitle>
          <SheetDescription>
            Servicios típicos pre-armados. Clickeá &quot;Importar&quot; en los que querés vender y después
            ajustá precio y proveedor desde el botón Editar de cada producto.
          </SheetDescription>
        </SheetHeader>

        {/* Search + filtros */}
        <div className="mt-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar (ej: catamarán, lavandería...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`px-3 h-7 rounded-full text-[11px] font-bold border ${
                categoryFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted/50"
              }`}
            >
              Todas ({templates.length})
            </button>
            {(Object.keys(UPSELL_CATEGORY_LABELS) as UpsellCategory[]).map((c) => {
              const count = categoriesWithCount[c] ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoryFilter(c)}
                  className={`px-3 h-7 rounded-full text-[11px] font-bold border ${
                    categoryFilter === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted/50"
                  }`}
                >
                  {UPSELL_CATEGORY_LABELS[c]} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid de templates */}
        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Cargando catálogo…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No hay templates que coincidan con la búsqueda.
            </div>
          ) : (
            filtered.map((t) => {
              const imported = justImported.has(t.id) || existingNames.has(t.name);
              const suffix = PRICING_SUFFIX[t.pricingModel];
              return (
                <div
                  key={t.id}
                  className="flex items-start gap-3 p-3 rounded-xl border bg-background hover:shadow-md transition-shadow"
                >
                  <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    {getIcon(t.iconName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{t.name}</p>
                      <Badge variant="outline" className="text-[9px]">
                        {UPSELL_CATEGORY_LABELS[t.category] ?? t.category}
                      </Badge>
                    </div>
                    {t.description && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-lg font-extrabold">
                        {formatMoney(t.suggestedPrice, t.currency)}
                      </span>
                      {suffix && (
                        <span className="text-[10px] text-muted-foreground">/ {suffix}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground italic ml-2">precio sugerido</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {imported ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        className="text-emerald-700 border-emerald-200 bg-emerald-50"
                      >
                        <Check className="h-3 w-3 mr-1" /> Importado
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleImport(t)}
                        disabled={importing === t.id}
                        className="gradient-gold text-white"
                      >
                        {importing === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Importar"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {justImported.size > 0 && (
          <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-3 bg-emerald-50 border-t border-emerald-200 text-center text-xs text-emerald-800 font-semibold">
            ✓ {justImported.size} producto{justImported.size === 1 ? "" : "s"} importado{justImported.size === 1 ? "" : "s"}.
            Cerrá este panel para editarlos.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
