"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ShoppingCart,
  Plus,
  Clock,
  Car,
  UtensilsCrossed,
  Sparkles,
  Baby,
  DollarSign,
  TrendingUp,
  Package,
  Edit,
  Trash2,
  Copy,
  ExternalLink,
  MapPin,
  Store,
  Palmtree,
  Loader2,
  Users as UsersIcon,
  Phone,
  Star,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import type { Upsell, UpsellCategory, PricingModel } from "@/types/upsell";
import { PRICING_MODEL_LABELS, PRICING_MODEL_SUFFIX, UPSELL_DEFAULT_ICON } from "@/types/upsell";
import type { UpsellVendor, UpsellVendorCategory, PaymentTerms } from "@/types/upsellVendor";
import { UPSELL_VENDOR_CATEGORY_LABELS, PAYMENT_TERMS_LABELS } from "@/types/upsellVendor";

interface PropertyLite {
  id: string;
  name: string;
}

const iconsMap: Record<string, React.ElementType> = {
  Clock,
  Car,
  UtensilsCrossed,
  Sparkles,
  Baby,
  Palmtree,
  Store,
  Package,
};

// ── Form state types ─────────────────────────────────────────────────────────
interface UpsellFormState {
  name: string;
  description: string;
  price: number;
  category: UpsellCategory;
  iconName: string;
  pricingModel: PricingModel;
  minQuantity: number;
  maxQuantity: string;       // string para permitir vacío en el input
  capacityPerSlot: string;
  cutoffHours: number;
  isGlobal: boolean;
  linkedPropertyIds: string[];
  vendorId: string | null;
  active: boolean;
}

const emptyUpsellForm: UpsellFormState = {
  name: "",
  description: "",
  price: 0,
  category: "service",
  iconName: "Sparkles",
  pricingModel: "fixed",
  minQuantity: 1,
  maxQuantity: "",
  capacityPerSlot: "",
  cutoffHours: 0,
  isGlobal: true,
  linkedPropertyIds: [],
  vendorId: null,
  active: true,
};

interface VendorFormState {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  rncCedula: string;
  category: UpsellVendorCategory;
  description: string;
  languages: string[];
  commissionPercent: number;
  paymentTerms: PaymentTerms;
  notes: string;
  active: boolean;
}

const emptyVendorForm: VendorFormState = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  rncCedula: "",
  category: "excursion",
  description: "",
  languages: [],
  commissionPercent: 0,
  paymentTerms: "on_completion",
  notes: "",
  active: true,
};

export default function UpsellsPanel() {
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [vendors, setVendors] = useState<UpsellVendor[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Upsell sheet
  const [upsellSheetOpen, setUpsellSheetOpen] = useState(false);
  const [editingUpsellId, setEditingUpsellId] = useState<string | null>(null);
  const [upsellForm, setUpsellForm] = useState<UpsellFormState>(emptyUpsellForm);

  // Vendor sheet
  const [vendorSheetOpen, setVendorSheetOpen] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorFormState>(emptyVendorForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [upsellsRes, vendorsRes, propsRes] = await Promise.all([
        fetch("/api/upsells", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/upsell-vendors", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/properties", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (Array.isArray(upsellsRes?.upsells)) setUpsells(upsellsRes.upsells);
      if (Array.isArray(vendorsRes?.vendors)) setVendors(vendorsRes.vendors);
      if (Array.isArray(propsRes?.properties)) {
        setProperties(
          (propsRes.properties as { id: string; name: string }[]).map((p) => ({
            id: p.id,
            name: p.name,
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const totalRevenue = upsells.reduce((s, u) => s + u.revenue, 0);
    const totalSales = upsells.reduce((s, u) => s + u.salesCount, 0);
    return {
      revenue: totalRevenue,
      salesCount: totalSales,
      activeCount: upsells.filter((u) => u.active).length,
    };
  }, [upsells]);

  const getIconComponent = (name: string) => {
    const Icon = iconsMap[name] || Sparkles;
    return <Icon className="h-6 w-6 text-primary" />;
  };

  const vendorName = (vendorId: string | null): string | null => {
    if (!vendorId) return null;
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) return null;
    return v.displayName ?? v.name;
  };

  // ── Upsell handlers ───────────────────────────────────────────────────────
  const handleAddUpsell = () => {
    setEditingUpsellId(null);
    setUpsellForm(emptyUpsellForm);
    setUpsellSheetOpen(true);
  };

  const handleEditUpsell = (u: Upsell) => {
    setEditingUpsellId(u.id);
    setUpsellForm({
      name: u.name,
      description: u.description ?? "",
      price: u.price,
      category: u.category,
      iconName: u.iconName,
      pricingModel: u.pricingModel,
      minQuantity: u.minQuantity,
      maxQuantity: u.maxQuantity != null ? String(u.maxQuantity) : "",
      capacityPerSlot: u.capacityPerSlot != null ? String(u.capacityPerSlot) : "",
      cutoffHours: u.cutoffHours,
      isGlobal: u.isGlobal,
      linkedPropertyIds: u.linkedPropertyIds,
      vendorId: u.vendorId,
      active: u.active,
    });
    setUpsellSheetOpen(true);
  };

  const handleDeleteUpsell = async (id: string) => {
    if (!confirm("¿Eliminar este producto del catálogo?")) return;
    const res = await fetch(`/api/upsells?id=${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setUpsells((prev) => prev.filter((u) => u.id !== id));
    }
  };

  const handleSaveUpsell = async () => {
    if (saving) return;
    if (!upsellForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: upsellForm.name.trim(),
        description: upsellForm.description || null,
        price: Number(upsellForm.price) || 0,
        category: upsellForm.category,
        iconName: upsellForm.iconName,
        pricingModel: upsellForm.pricingModel,
        minQuantity: Number(upsellForm.minQuantity) || 1,
        maxQuantity: upsellForm.maxQuantity ? Number(upsellForm.maxQuantity) : null,
        capacityPerSlot: upsellForm.capacityPerSlot ? Number(upsellForm.capacityPerSlot) : null,
        cutoffHours: Number(upsellForm.cutoffHours) || 0,
        isGlobal: upsellForm.isGlobal,
        linkedPropertyIds: upsellForm.isGlobal ? [] : upsellForm.linkedPropertyIds,
        vendorId: upsellForm.vendorId,
        active: upsellForm.active,
      };

      if (editingUpsellId) {
        const res = await fetch(`/api/upsells?id=${editingUpsellId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert(j.error ?? "No se pudo guardar");
          return;
        }
        // Refresh full list para tener stats correctos y updated_at.
        await load();
      } else {
        const res = await fetch("/api/upsells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert(j.error ?? "No se pudo crear");
          return;
        }
        const { upsell } = (await res.json()) as { upsell: Upsell };
        setUpsells((prev) => [upsell, ...prev]);
      }
      setUpsellSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // ── Vendor handlers ───────────────────────────────────────────────────────
  const handleAddVendor = () => {
    setEditingVendorId(null);
    setVendorForm(emptyVendorForm);
    setVendorSheetOpen(true);
  };

  const handleEditVendor = (v: UpsellVendor) => {
    setEditingVendorId(v.id);
    setVendorForm({
      name: v.name,
      contactName: v.contactName ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
      rncCedula: v.rncCedula ?? "",
      category: v.category,
      description: v.description ?? "",
      languages: v.languages,
      commissionPercent: v.commissionPercent,
      paymentTerms: v.paymentTerms,
      notes: v.notes ?? "",
      active: v.active,
    });
    setVendorSheetOpen(true);
  };

  const handleDeleteVendor = async (id: string) => {
    const linkedUpsells = upsells.filter((u) => u.vendorId === id);
    const linkedNames = linkedUpsells.map((u) => u.name).join(", ");
    const msg = linkedUpsells.length > 0
      ? `Este proveedor está vinculado a ${linkedUpsells.length} producto(s): ${linkedNames}.\n\nSi continuás, esos productos quedan sin proveedor asignado (los entregás vos o reasignás después).\n\n¿Eliminar?`
      : "¿Eliminar este proveedor?";
    if (!confirm(msg)) return;
    const res = await fetch(`/api/upsell-vendors?id=${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setVendors((prev) => prev.filter((v) => v.id !== id));
      // FK on delete set null: refrescar upsells para reflejar vendor_id=null
      await load();
    }
  };

  const handleSaveVendor = async () => {
    if (saving) return;
    if (!vendorForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: vendorForm.name.trim(),
        contactName: vendorForm.contactName || null,
        phone: vendorForm.phone || null,
        email: vendorForm.email || null,
        rncCedula: vendorForm.rncCedula || null,
        category: vendorForm.category,
        description: vendorForm.description || null,
        languages: vendorForm.languages,
        commissionPercent: Number(vendorForm.commissionPercent) || 0,
        paymentTerms: vendorForm.paymentTerms,
        notes: vendorForm.notes || null,
        active: vendorForm.active,
      };

      if (editingVendorId) {
        const res = await fetch(`/api/upsell-vendors?id=${editingVendorId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert(j.error ?? "No se pudo guardar");
          return;
        }
        await load();
      } else {
        const res = await fetch("/api/upsell-vendors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert(j.error ?? "No se pudo crear");
          return;
        }
        const { vendor } = (await res.json()) as { vendor: UpsellVendor };
        setVendors((prev) => [vendor, ...prev]);
      }
      setVendorSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // Cambio de categoría sugiere icono default si el actual coincidía.
  const updateUpsellCategory = (next: UpsellCategory) => {
    setUpsellForm((prev) => ({
      ...prev,
      category: next,
      iconName:
        prev.iconName === UPSELL_DEFAULT_ICON[prev.category]
          ? UPSELL_DEFAULT_ICON[next]
          : prev.iconName,
    }));
  };

  // Sufijo del precio según pricing model (ej "/ persona", "/ kg")
  const priceSuffix = (pm: PricingModel) => PRICING_MODEL_SUFFIX[pm];

  // Calculadora de ejemplo para mostrar al host cómo se cobra
  const priceExample = (price: number, pm: PricingModel, qty: number): string => {
    if (pm === "fixed") return formatMoney(price, "USD");
    const total = price * qty;
    return `${formatMoney(price, "USD")} × ${qty} = ${formatMoney(total, "USD")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Marketplace y Ventas Extras</h2>
          <p className="text-muted-foreground">Configura tu Host Hub para vender tours, transporte y servicios extra a tus huéspedes.</p>
        </div>
      </div>

      <Tabs defaultValue="inventory" className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:w-[600px]">
          <TabsTrigger value="inventory">Productos</TabsTrigger>
          <TabsTrigger value="vendors">Proveedores</TabsTrigger>
          <TabsTrigger value="hub-config">Hub público</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: PRODUCTOS ─────────────────────────────────────────── */}
        <TabsContent value="inventory" className="space-y-6 mt-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatMoney(stats.revenue, "USD")}</p>
                  <p className="text-sm text-muted-foreground">Ingresos Tienda/Extras</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.salesCount}</p>
                  <p className="text-sm text-muted-foreground">Ventas totales</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">—</p>
                  <p className="text-sm text-muted-foreground">Tasa de conversión</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeCount}</p>
                  <p className="text-sm text-muted-foreground">Productos activos</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-between items-center flex-wrap gap-4">
            <h3 className="text-lg font-semibold">Tus Productos y Experiencias</h3>
            <Button onClick={handleAddUpsell} className="gradient-gold text-primary-foreground gap-2">
              <Plus className="h-4 w-4" />
              Nuevo producto
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="p-12 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando catálogo…
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {upsells.map((upsell) => {
                const vName = vendorName(upsell.vendorId);
                return (
                  <Card key={upsell.id} className={`relative transition-all hover:shadow-md ${!upsell.active && "opacity-60"}`}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-3 rounded-xl bg-primary/10">
                          {getIconComponent(upsell.iconName)}
                        </div>
                        <Badge variant={upsell.active ? "default" : "secondary"} className={upsell.active ? "bg-chart-2" : ""}>
                          {upsell.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>

                      <h3 className="font-semibold text-lg line-clamp-1" title={upsell.name}>{upsell.name}</h3>
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px]">
                        {upsell.description || <span className="italic opacity-60">Sin descripción</span>}
                      </p>

                      <div className="flex items-baseline gap-1 mb-2">
                        <span className="text-2xl font-bold">{formatMoney(upsell.price, "USD")}</span>
                        {priceSuffix(upsell.pricingModel) && (
                          <span className="text-muted-foreground text-xs">/ {priceSuffix(upsell.pricingModel)}</span>
                        )}
                      </div>

                      {/* Quantity / capacity hints */}
                      {(upsell.minQuantity > 1 || upsell.maxQuantity || upsell.capacityPerSlot || upsell.cutoffHours > 0) && (
                        <div className="text-[11px] text-muted-foreground mb-3 space-y-0.5">
                          {(upsell.minQuantity > 1 || upsell.maxQuantity) && (
                            <p>
                              {upsell.minQuantity > 1 && `Mín ${upsell.minQuantity}`}
                              {upsell.minQuantity > 1 && upsell.maxQuantity && " · "}
                              {upsell.maxQuantity && `Máx ${upsell.maxQuantity}`}
                            </p>
                          )}
                          {upsell.capacityPerSlot && <p>Capacidad: {upsell.capacityPerSlot}/día</p>}
                          {upsell.cutoffHours > 0 && <p>Cierra {upsell.cutoffHours}h antes</p>}
                        </div>
                      )}

                      <div className="flex gap-2 mb-4 flex-wrap">
                        {upsell.isGlobal ? (
                          <Badge variant="outline" className="text-xs bg-muted/50 border-primary/20 text-primary">
                            <Store className="h-3 w-3 mr-1" /> Hub público
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-muted/50">
                            <MapPin className="h-3 w-3 mr-1" /> {upsell.linkedPropertyIds.length} prop.
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs uppercase">{upsell.category}</Badge>
                        {vName && (
                          <Badge variant="outline" className="text-xs">
                            👤 {vName}
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                          <p className="text-sm text-muted-foreground">Ventas</p>
                          <p className="font-semibold">{upsell.salesCount}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Generado</p>
                          <p className="font-semibold text-chart-2">{formatMoney(upsell.revenue, "USD")}</p>
                        </div>
                      </div>

                      <div className="flex gap-2 mt-4 pt-4 border-t">
                        <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => handleEditUpsell(upsell)}>
                          <Edit className="h-4 w-4 text-muted-foreground" />
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white" onClick={() => handleDeleteUpsell(upsell.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              <Card onClick={handleAddUpsell} className="border-dashed cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
                <CardContent className="p-6 flex flex-col items-center justify-center h-full min-h-[350px]">
                  <div className="p-4 rounded-full bg-primary/10 mb-4 transition-transform hover:scale-110">
                    <Plus className="h-8 w-8 text-primary" />
                  </div>
                  <p className="font-medium text-foreground">Agregar nueva experiencia</p>
                  <p className="text-sm text-muted-foreground text-center mt-2 px-4">
                    Crea tours, traslados o servicios para venderlos en tu Hub.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── TAB 2: PROVEEDORES ───────────────────────────────────────── */}
        <TabsContent value="vendors" className="space-y-6 mt-6">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <UsersIcon className="h-5 w-5 text-primary" />
                Proveedores de Tienda
              </h3>
              <p className="text-sm text-muted-foreground">
                Capitanes, conductores, spa, chef privado. Los que despachan tus productos al huésped.
              </p>
            </div>
            <Button onClick={handleAddVendor} className="gradient-gold text-primary-foreground gap-2">
              <Plus className="h-4 w-4" />
              Nuevo proveedor
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="p-12 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
              </CardContent>
            </Card>
          ) : vendors.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <UsersIcon className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Aún no tenés proveedores de tienda.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Agregá al capitán del catamarán, al transporte aeropuerto, a la lavandería, etc.
                </p>
                <Button variant="outline" onClick={handleAddVendor} className="mt-4">
                  <Plus className="w-4 h-4 mr-1" /> Agregar el primero
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {vendors.map((v) => {
                const linkedCount = upsells.filter((u) => u.vendorId === v.id).length;
                return (
                  <Card key={v.id} className={`hover:shadow-md transition-all ${!v.active && "opacity-60"}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-base truncate">{v.displayName ?? v.name}</h4>
                          {v.displayName && v.displayName !== v.name && (
                            <p className="text-[11px] text-muted-foreground truncate">interno: {v.name}</p>
                          )}
                        </div>
                        {v.rating !== null && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                            <span className="text-xs font-bold">{v.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>

                      <Badge variant="secondary" className="text-[10px] mb-3">
                        {UPSELL_VENDOR_CATEGORY_LABELS[v.category]}
                      </Badge>

                      {v.description && (
                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{v.description}</p>
                      )}

                      <div className="space-y-1 text-xs text-slate-600 mb-3">
                        {v.contactName && (
                          <p className="flex items-center gap-1">
                            <UsersIcon className="h-3 w-3" /> {v.contactName}
                          </p>
                        )}
                        {v.phone && (
                          <p className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <a
                              href={`https://wa.me/${v.phone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {v.phone}
                            </a>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-3 border-t">
                        <span className="text-muted-foreground">
                          Comisión: <strong className="text-foreground">{v.commissionPercent}%</strong>
                        </span>
                        <span className="text-muted-foreground">
                          {linkedCount} producto{linkedCount === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="flex gap-2 mt-3">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEditVendor(v)}>
                          <Edit className="h-3 w-3 mr-1" /> Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive hover:text-white"
                          onClick={() => handleDeleteVendor(v.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── TAB 3: HUB CONFIG ────────────────────────────────────────── */}
        <TabsContent value="hub-config" className="mt-6">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>Configuración de tu Host Hub</CardTitle>
              <CardDescription>
                Personaliza la página pública donde tus huéspedes podrán comprar tus experiencias y servicios independientemente de Airbnb.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 border rounded-xl bg-muted/30 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex-1 overflow-hidden">
                  <Label>Enlace Público (URL Compartible)</Label>
                  <p className="text-sm font-mono text-muted-foreground flex items-center bg-background border rounded-md p-2 mt-2 w-full truncate italic">
                    Se generará al configurar tu Hub
                  </p>
                </div>
                <div className="flex gap-2 md:mt-6 shrink-0">
                  {/* Hub público no está implementado todavía — deshabilitamos
                      en lugar de mostrar botones que abren URLs inválidas. */}
                  <Button variant="outline" disabled title="Próximamente">
                    <Copy className="h-4 w-4 mr-2" /> Copiar
                  </Button>
                  <Button disabled title="Próximamente">
                    <ExternalLink className="h-4 w-4 mr-2" /> Visitar
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nombre del Hub / Marca</Label>
                  <Input defaultValue="Luna Vacations Rentals" />
                </div>
                <div className="space-y-2">
                  <Label>Mensaje de Bienvenida al Huésped</Label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    defaultValue="Mejora tu estadía con nuestras actividades locales recomendadas y curadas por nosotros."
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 py-4 border-t">
              <Button
                className="ml-auto gradient-gold opacity-60"
                disabled
                title="Próximamente — la configuración del Hub aún no se guarda"
              >
                Guardar Configuración (Próximamente)
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── UPSELL SHEET ─────────────────────────────────────────────────── */}
      <Sheet open={upsellSheetOpen} onOpenChange={setUpsellSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>{editingUpsellId ? "Editar Producto" : "Nuevo Producto"}</SheetTitle>
            <SheetDescription>
              Configura los detalles de esta experiencia o servicio adicional.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Producto</Label>
              <Input
                id="name"
                value={upsellForm.name}
                onChange={(e) => setUpsellForm({ ...upsellForm, name: e.target.value })}
                placeholder="Ej: Catamarán Bávaro Beach"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">Descripción breve</Label>
              <Textarea
                id="desc"
                rows={3}
                value={upsellForm.description}
                onChange={(e) => setUpsellForm({ ...upsellForm, description: e.target.value })}
                placeholder="Qué incluye, duración, qué llevar…"
              />
            </div>

            {/* Pricing block — la parte clave de Sprint 1.5 */}
            <div className="space-y-4 p-4 border rounded-xl bg-muted/20">
              <h4 className="font-medium text-sm">Precio y cantidad</h4>

              <div className="space-y-2">
                <Label>Modelo de precio</Label>
                <Select value={upsellForm.pricingModel} onValueChange={(v) => setUpsellForm({ ...upsellForm, pricingModel: v as PricingModel })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRICING_MODEL_LABELS) as PricingModel[]).map((pm) => (
                      <SelectItem key={pm} value={pm}>{PRICING_MODEL_LABELS[pm]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {upsellForm.pricingModel === "per_person"
                    ? "Ej: catamarán US$85 × 4 personas = US$340"
                    : upsellForm.pricingModel === "per_kg"
                      ? "Ej: lavandería US$5 × 3kg = US$15"
                      : upsellForm.pricingModel === "per_night"
                        ? "Ej: cuna US$10 × 5 noches = US$50"
                        : upsellForm.pricingModel === "per_unit"
                          ? "Ej: jet ski US$80 × 2 unidades = US$160"
                          : "Un solo cobro fijo, sin importar cantidad"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="price">
                    Precio (US$){upsellForm.pricingModel !== "fixed" ? ` por ${priceSuffix(upsellForm.pricingModel)}` : ""}
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="number"
                      id="price"
                      className="pl-8"
                      value={upsellForm.price || ""}
                      onChange={(e) => setUpsellForm({ ...upsellForm, price: Number(e.target.value) })}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Vista previa</Label>
                  {/* Usa minQuantity como base del ejemplo (más representativo
                      del mínimo real del producto). Cae a 2 si min es 1. */}
                  <div className="h-10 px-3 rounded-md bg-background border flex items-center text-sm">
                    {priceExample(
                      upsellForm.price || 0,
                      upsellForm.pricingModel,
                      Math.max(2, upsellForm.minQuantity || 1),
                    )}
                  </div>
                  {upsellForm.pricingModel !== "fixed" && (
                    <p className="text-[10px] text-muted-foreground">
                      Lo que pagan {Math.max(2, upsellForm.minQuantity || 1)} {priceSuffix(upsellForm.pricingModel)}s
                    </p>
                  )}
                </div>
              </div>

              {upsellForm.pricingModel !== "fixed" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Mínimo</Label>
                    <Input
                      type="number"
                      min={1}
                      value={upsellForm.minQuantity}
                      onChange={(e) => setUpsellForm({ ...upsellForm, minQuantity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Máximo (opcional)</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Sin tope"
                      value={upsellForm.maxQuantity}
                      onChange={(e) => setUpsellForm({ ...upsellForm, maxQuantity: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Capacidad por día</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Sin límite"
                    value={upsellForm.capacityPerSlot}
                    onChange={(e) => setUpsellForm({ ...upsellForm, capacityPerSlot: e.target.value })}
                  />
                  <p className="text-[10px] text-muted-foreground">Total disponible por jornada</p>
                </div>
                <div className="space-y-2">
                  <Label>Cierra venta (hrs antes)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={upsellForm.cutoffHours}
                    onChange={(e) => setUpsellForm({ ...upsellForm, cutoffHours: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <p className="text-[10px] text-muted-foreground">Ej: 6h para shuttle PUJ</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={upsellForm.category} onValueChange={(val) => updateUpsellCategory(val as UpsellCategory)}>
                <SelectTrigger>
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">🔧 Servicio</SelectItem>
                  <SelectItem value="experience">🌴 Experiencia</SelectItem>
                  <SelectItem value="food">🍽️ Gastronomía</SelectItem>
                  <SelectItem value="transport">🚗 Transporte</SelectItem>
                  <SelectItem value="other">📦 Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select
                value={upsellForm.vendorId ?? "_none"}
                onValueChange={(val) => setUpsellForm({ ...upsellForm, vendorId: val === "_none" ? null : val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor — lo entrego yo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin proveedor — lo entrego yo</SelectItem>
                  {vendors.filter((v) => v.active).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.displayName ?? v.name}
                      {v.phone ? ` · ${v.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vendors.length === 0 && (
                <p className="text-[11px] text-amber-600">
                  Aún no agregaste proveedores. Andá al tab &quot;Proveedores&quot; para crear uno.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Icono / Visual</Label>
              <Select value={upsellForm.iconName} onValueChange={(val) => setUpsellForm({ ...upsellForm, iconName: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Icono Principal" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(iconsMap).map((iconKey) => (
                    <SelectItem key={iconKey} value={iconKey}>{iconKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4 p-4 border rounded-xl bg-muted/20">
              <h4 className="font-medium text-sm">Disponibilidad de Venta</h4>
              <div className="flex flex-col space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input
                    type="radio"
                    name="isGlobal"
                    checked={upsellForm.isGlobal === true}
                    onChange={() => setUpsellForm({ ...upsellForm, isGlobal: true })}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">✨ Venta Global (Host Hub)</strong>
                    <span className="text-muted-foreground text-xs block">Visible en el Hub público, abierto a cualquier huésped.</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input
                    type="radio"
                    name="isGlobal"
                    checked={upsellForm.isGlobal === false}
                    onChange={() => setUpsellForm({ ...upsellForm, isGlobal: false })}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">🏠 Vinculado a Propiedades</strong>
                    <span className="text-muted-foreground text-xs block">Solo se ofrece a huéspedes de las propiedades elegidas.</span>
                  </span>
                </label>
              </div>

              {!upsellForm.isGlobal && (
                <div className="mt-4 space-y-2 pt-4 border-t border-border">
                  <Label>Aplica a estas propiedades:</Label>
                  {properties.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No hay propiedades cargadas todavía.</p>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {properties.map((prop) => {
                        const checked = upsellForm.linkedPropertyIds.includes(prop.id);
                        return (
                          <label key={prop.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/30 px-2 py-1 rounded">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setUpsellForm((prev) => ({
                                  ...prev,
                                  linkedPropertyIds: e.target.checked
                                    ? [...prev.linkedPropertyIds, prop.id]
                                    : prev.linkedPropertyIds.filter((id) => id !== prop.id),
                                }));
                              }}
                              className="rounded border-gray-300"
                            />
                            {prop.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                <input
                  type="checkbox"
                  checked={upsellForm.active}
                  onChange={(e) => setUpsellForm({ ...upsellForm, active: e.target.checked })}
                  className="h-4 w-4 rounded text-primary"
                />
                Activo (visible en el Hub)
              </label>
            </div>
          </div>

          <SheetFooter className="mt-8 gap-2 sm:gap-0">
            <SheetClose asChild>
              <Button variant="outline" disabled={saving}>Cancelar</Button>
            </SheetClose>
            <Button onClick={handleSaveUpsell} disabled={saving || !upsellForm.name.trim()} className="gradient-gold">
              {saving ? "Guardando…" : editingUpsellId ? "Guardar cambios" : "Crear producto"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ─── VENDOR SHEET ─────────────────────────────────────────────────── */}
      <Sheet open={vendorSheetOpen} onOpenChange={setVendorSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>{editingVendorId ? "Editar Proveedor" : "Nuevo Proveedor de Tienda"}</SheetTitle>
            <SheetDescription>
              Datos del proveedor que despacha tus productos al huésped.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="vname">Nombre (interno)</Label>
              <Input
                id="vname"
                value={vendorForm.name}
                onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                placeholder="Ej: Bávaro Adventures SRL"
              />
              <p className="text-[11px] text-muted-foreground">Cómo lo llamás en tus notas. Privado.</p>
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={vendorForm.category} onValueChange={(v) => setVendorForm({ ...vendorForm, category: v as UpsellVendorCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(UPSELL_VENDOR_CATEGORY_LABELS) as UpsellVendorCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{UPSELL_VENDOR_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Contacto</Label>
                <Input
                  value={vendorForm.contactName}
                  onChange={(e) => setVendorForm({ ...vendorForm, contactName: e.target.value })}
                  placeholder="Capitán Pedro"
                />
              </div>
              <div className="space-y-2">
                <Label>RNC / Cédula</Label>
                <Input
                  value={vendorForm.rncCedula}
                  onChange={(e) => setVendorForm({ ...vendorForm, rncCedula: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>WhatsApp</Label>
                <Input
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                  placeholder="+1 809..."
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción (qué hace)</Label>
              <Textarea
                value={vendorForm.description}
                onChange={(e) => setVendorForm({ ...vendorForm, description: e.target.value })}
                placeholder="Tour operator con 8 años en Bávaro. Especialidad: catamarán y snorkel."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Comisión (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={vendorForm.commissionPercent}
                    onChange={(e) => setVendorForm({ ...vendorForm, commissionPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">% que retenés del precio</p>
              </div>
              <div className="space-y-2">
                <Label>Pago al vendor</Label>
                <Select value={vendorForm.paymentTerms} onValueChange={(v) => setVendorForm({ ...vendorForm, paymentTerms: v as PaymentTerms })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_TERMS_LABELS) as PaymentTerms[]).map((pt) => (
                      <SelectItem key={pt} value={pt}>{PAYMENT_TERMS_LABELS[pt]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notas internas</Label>
              <Textarea
                value={vendorForm.notes}
                onChange={(e) => setVendorForm({ ...vendorForm, notes: e.target.value })}
                placeholder="Horarios, banco para transferencias, persona de respaldo…"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                <input
                  type="checkbox"
                  checked={vendorForm.active}
                  onChange={(e) => setVendorForm({ ...vendorForm, active: e.target.checked })}
                  className="h-4 w-4 rounded text-primary"
                />
                Activo
              </label>
            </div>
          </div>

          <SheetFooter className="mt-8 gap-2 sm:gap-0">
            <SheetClose asChild>
              <Button variant="outline" disabled={saving}>Cancelar</Button>
            </SheetClose>
            <Button onClick={handleSaveVendor} disabled={saving || !vendorForm.name.trim()} className="gradient-gold">
              {saving ? "Guardando…" : editingVendorId ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
