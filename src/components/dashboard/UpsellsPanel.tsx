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
  Sparkles,
  DollarSign,
  TrendingUp,
  Package,
  Edit,
  Trash2,
  Copy,
  ExternalLink,
  MapPin,
  Store,
  Loader2,
  Users as UsersIcon,
  Phone,
  Star,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import PhotoUploader from "@/components/dashboard/PhotoUploader";
import OrdersTab from "@/components/dashboard/OrdersTab";
import UpsellTemplateCatalog from "@/components/dashboard/UpsellTemplateCatalog";
import type { Upsell, UpsellCategory, PricingModel, UpsellFieldVisibility } from "@/types/upsell";
import { PRICING_MODEL_LABELS, PRICING_MODEL_SUFFIX, UPSELL_DEFAULT_ICON, UPSELL_CATEGORY_LABELS, FIELD_VISIBILITY_LABELS } from "@/types/upsell";
import type { UpsellVendor, PaymentTerms, VendorPricingMethod } from "@/types/upsellVendor";
import { PAYMENT_TERMS_LABELS, VENDOR_PRICING_METHOD_LABELS, VENDOR_PRICING_VALUE_LABEL } from "@/types/upsellVendor";
import { CategoryHero, UPSELL_ICON_OPTIONS } from "@/lib/upsell/categoryVisuals";

interface PropertyLite {
  id: string;
  name: string;
}

// ── Form state types ─────────────────────────────────────────────────────────
interface UpsellFormState {
  name: string;
  description: string;
  price: number;
  category: UpsellCategory;
  iconName: string;
  heroPhoto: string | null;
  galleryPhotos: string[];
  pricingModel: PricingModel;
  minQuantity: number;
  maxQuantity: string;
  capacityPerSlot: string;
  cutoffHours: number;
  // Override del trato con el vendor. Si overrideVendorAgreement=false, los
  // campos se ignoran al guardar y el producto hereda los defaults del vendor.
  overrideVendorAgreement: boolean;
  vendorPricingMethod: VendorPricingMethod;
  vendorCost: string;
  vendorCommissionPercent: string;
  vendorFlatFee: string;
  // Sprint 5 — visibility por campo (off / optional / required).
  timeField: UpsellFieldVisibility;
  pickupField: UpsellFieldVisibility;
  flightField: UpsellFieldVisibility;
  notesPlaceholder: string;
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
  heroPhoto: null,
  galleryPhotos: [],
  pricingModel: "fixed",
  minQuantity: 1,
  maxQuantity: "",
  capacityPerSlot: "",
  cutoffHours: 0,
  overrideVendorAgreement: false,
  vendorPricingMethod: "commission",
  vendorCost: "",
  vendorCommissionPercent: "",
  vendorFlatFee: "",
  timeField: "off",
  pickupField: "off",
  flightField: "off",
  notesPlaceholder: "",
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
  category: UpsellCategory;
  description: string;
  heroPhoto: string | null;
  languages: string[];
  // Método y valores asociados. Solo el valor del método activo importa
  // al guardar; los otros campos quedan ignorados (pero se preservan para
  // que cambiar de método y volver no pierda lo tipeado).
  defaultPricingMethod: VendorPricingMethod;
  commissionPercent: number;
  defaultFixedCost: string;
  defaultFlatFee: string;
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
  heroPhoto: null,
  languages: [],
  defaultPricingMethod: "commission",
  commissionPercent: 0,
  defaultFixedCost: "",
  defaultFlatFee: "",
  paymentTerms: "on_completion",
  notes: "",
  active: true,
};

export default function UpsellsPanel() {
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [vendors, setVendors] = useState<UpsellVendor[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  // tenantId se usa para construir el path de las fotos en Storage. RLS
  // path-based exige que el primer segmento sea el tenant del caller.
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // IDs temporales generados al abrir el form de creación. Permiten que
  // el host suba fotos ANTES de guardar el producto/vendor (cuando aún no
  // hay ID real en BD). Al guardar, las URLs van al body y quedan
  // asociadas al producto creado. Si cancela, los archivos quedan
  // huérfanos en Storage — el bucket free tier lo aguanta de sobra.
  const [tempUpsellId, setTempUpsellId] = useState<string>("");
  const [tempVendorId, setTempVendorId] = useState<string>("");

  // Catálogo de templates Punta Cana (Sprint 4)
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Upsell sheet
  const [upsellSheetOpen, setUpsellSheetOpen] = useState(false);
  const [editingUpsellId, setEditingUpsellId] = useState<string | null>(null);
  const [upsellForm, setUpsellForm] = useState<UpsellFormState>(emptyUpsellForm);

  // Vendor sheet
  const [vendorSheetOpen, setVendorSheetOpen] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorFormState>(emptyVendorForm);

  // Hub config tab state — antes era hardcoded "Luna Vacations Rentals" sin
  // persistencia. Ahora levanta de /api/settings (tenant.company y
  // tenant.hub_welcome_message) y persiste con PATCH.
  const [hubName, setHubName] = useState<string>("");
  const [hubWelcome, setHubWelcome] = useState<string>("");
  const [hubSaving, setHubSaving] = useState(false);
  const [hubSaved, setHubSaved] = useState(false);
  // Estado de "¡Copiado!" por URL. El host comparte dos enlaces distintos:
  // hub completo (/hub/{id}) y solo-ventas-extras (/hub/{id}/extras).
  const [copiedKey, setCopiedKey] = useState<"full" | "extras" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, upsellsRes, vendorsRes, propsRes, settingsRes] = await Promise.all([
        fetch("/api/me", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/upsells", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/upsell-vendors", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/properties", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/settings", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (meRes?.tenantId) setTenantId(meRes.tenantId);
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
      // Hub config: el endpoint devuelve company (marca) y hubWelcomeMessage.
      // Si company es null (host nuevo), caemos a name como sugerencia.
      if (settingsRes) {
        setHubName(settingsRes.company ?? settingsRes.name ?? "");
        setHubWelcome(settingsRes.hubWelcomeMessage ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // URL pública del hub. tenantId es la fuente canónica — los QR y enlaces
  // de WhatsApp del host apuntan a /hub/{tenantId}. Cuando agreguemos slug
  // amigable en otro sprint, este getter cambia.
  const hubUrl = useMemo(() => {
    if (!tenantId) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/hub/${tenantId}`;
  }, [tenantId]);

  // URL "solo ventas extras": misma data del hub pero sin la sección de
  // propiedades. Pensada para huéspedes que ya reservaron por Airbnb/
  // Booking/VRBO y solo quieren comprar excursiones/transporte/comida.
  const hubExtrasUrl = useMemo(() => {
    if (!hubUrl) return null;
    return `${hubUrl}/extras`;
  }, [hubUrl]);

  const saveHubConfig = async () => {
    if (hubSaving) return;
    setHubSaving(true);
    setHubSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // company puede ser "" → null (limpia el campo). El backend ya
          // hace el coerce a null cuando viene string vacío.
          company: hubName.trim() || null,
          hubWelcomeMessage: hubWelcome.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "No se pudo guardar la configuración del Hub");
        return;
      }
      setHubSaved(true);
      // Reset del flag de "Guardado" después de 3s para que vuelva a verse
      // el estado neutro listo para próximo edit.
      setTimeout(() => setHubSaved(false), 3000);
    } finally {
      setHubSaving(false);
    }
  };

  const copyHubUrl = async (key: "full" | "extras", url: string | null) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch {
      // Fallback: prompt para que el usuario copie manualmente.
      prompt("Copiá la URL del Hub:", url);
    }
  };

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
    // ID temporal para el path de las fotos antes de tener el ID real
    // del producto. Se descarta al cerrar sin guardar (archivos huérfanos).
    setTempUpsellId(crypto.randomUUID());
    setUpsellSheetOpen(true);
  };

  const handleEditUpsell = (u: Upsell) => {
    setEditingUpsellId(u.id);
    // Si CUALQUIER override está seteado, abrimos el form con el switch en
    // "override personalizado". Si los 4 son null, el producto hereda del
    // vendor y arrancamos colapsado.
    const hasOverride =
      u.vendorPricingMethod !== null ||
      u.vendorCost !== null ||
      u.vendorCommissionPercent !== null ||
      u.vendorFlatFee !== null;
    setUpsellForm({
      name: u.name,
      description: u.description ?? "",
      price: u.price,
      category: u.category,
      iconName: u.iconName,
      heroPhoto: u.heroPhoto,
      galleryPhotos: u.galleryPhotos,
      pricingModel: u.pricingModel,
      minQuantity: u.minQuantity,
      maxQuantity: u.maxQuantity != null ? String(u.maxQuantity) : "",
      capacityPerSlot: u.capacityPerSlot != null ? String(u.capacityPerSlot) : "",
      cutoffHours: u.cutoffHours,
      overrideVendorAgreement: hasOverride,
      vendorPricingMethod: u.vendorPricingMethod ?? "commission",
      vendorCost: u.vendorCost != null ? String(u.vendorCost) : "",
      vendorCommissionPercent:
        u.vendorCommissionPercent != null ? String(u.vendorCommissionPercent) : "",
      vendorFlatFee: u.vendorFlatFee != null ? String(u.vendorFlatFee) : "",
      timeField: u.timeField,
      pickupField: u.pickupField,
      flightField: u.flightField,
      notesPlaceholder: u.notesPlaceholder ?? "",
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

    // Validación cliente: si override está ON, el valor del método activo
    // no puede estar vacío — sino el margen calculado es engañoso.
    if (upsellForm.overrideVendorAgreement) {
      const valueByMethod: Record<VendorPricingMethod, string> = {
        commission: upsellForm.vendorCommissionPercent,
        fixed_cost: upsellForm.vendorCost,
        flat_fee: upsellForm.vendorFlatFee,
      };
      const value = valueByMethod[upsellForm.vendorPricingMethod];
      if (!value || Number.isNaN(Number(value))) {
        alert(
          "Completá el valor del método de pricing override (comisión %, costo o fee) o desactivá el override.",
        );
        return;
      }
    }

    setSaving(true);
    try {
      // Si override está OFF, mandamos los 4 campos en null para que el
      // producto herede del vendor. Si está ON, solo seteamos el campo del
      // método activo y el resto null — patrón "campo activo gana".
      const override = upsellForm.overrideVendorAgreement;
      const payload = {
        name: upsellForm.name.trim(),
        description: upsellForm.description || null,
        price: Number(upsellForm.price) || 0,
        category: upsellForm.category,
        iconName: upsellForm.iconName,
        heroPhoto: upsellForm.heroPhoto,
        // Filtrar slots vacíos (el host agregó un placeholder pero no subió).
        galleryPhotos: upsellForm.galleryPhotos.filter((u) => !!u),
        pricingModel: upsellForm.pricingModel,
        minQuantity: Number(upsellForm.minQuantity) || 1,
        maxQuantity: upsellForm.maxQuantity ? Number(upsellForm.maxQuantity) : null,
        capacityPerSlot: upsellForm.capacityPerSlot ? Number(upsellForm.capacityPerSlot) : null,
        cutoffHours: Number(upsellForm.cutoffHours) || 0,
        vendorPricingMethod: override ? upsellForm.vendorPricingMethod : null,
        vendorCost:
          override && upsellForm.vendorPricingMethod === "fixed_cost" && upsellForm.vendorCost
            ? Number(upsellForm.vendorCost)
            : null,
        vendorCommissionPercent:
          override && upsellForm.vendorPricingMethod === "commission" && upsellForm.vendorCommissionPercent
            ? Number(upsellForm.vendorCommissionPercent)
            : null,
        vendorFlatFee:
          override && upsellForm.vendorPricingMethod === "flat_fee" && upsellForm.vendorFlatFee
            ? Number(upsellForm.vendorFlatFee)
            : null,
        // Sprint 5 — info del servicio que se le pedirá al huésped.
        timeField: upsellForm.timeField,
        pickupField: upsellForm.pickupField,
        flightField: upsellForm.flightField,
        notesPlaceholder: upsellForm.notesPlaceholder.trim() || null,
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
    setTempVendorId(crypto.randomUUID());
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
      heroPhoto: v.heroPhoto,
      languages: v.languages,
      defaultPricingMethod: v.defaultPricingMethod,
      commissionPercent: v.commissionPercent,
      defaultFixedCost: v.defaultFixedCost != null ? String(v.defaultFixedCost) : "",
      defaultFlatFee: v.defaultFlatFee != null ? String(v.defaultFlatFee) : "",
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
        heroPhoto: vendorForm.heroPhoto,
        languages: vendorForm.languages,
        defaultPricingMethod: vendorForm.defaultPricingMethod,
        commissionPercent: Number(vendorForm.commissionPercent) || 0,
        defaultFixedCost: vendorForm.defaultFixedCost ? Number(vendorForm.defaultFixedCost) : null,
        defaultFlatFee: vendorForm.defaultFlatFee ? Number(vendorForm.defaultFlatFee) : null,
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
        <TabsList className="grid w-full grid-cols-4 md:w-[700px]">
          <TabsTrigger value="inventory">Productos</TabsTrigger>
          <TabsTrigger value="vendors">Proveedores</TabsTrigger>
          <TabsTrigger value="orders">Pedidos</TabsTrigger>
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
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => setCatalogOpen(true)}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                Importar del catálogo Punta Cana
              </Button>
              <Button onClick={handleAddUpsell} className="gradient-gold text-primary-foreground gap-2">
                <Plus className="h-4 w-4" />
                Nuevo producto
              </Button>
            </div>
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
                  <Card key={upsell.id} className={`relative transition-all hover:shadow-md overflow-hidden ${!upsell.active && "opacity-60"}`}>
                    {/* Header: foto si el host la subió, gradient + ícono de
                        categoría como fallback. Siempre presente para que el
                        card se vea consistente, foto o no. */}
                    <div className="relative h-36 bg-muted">
                      {upsell.heroPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={upsell.heroPhoto}
                          alt={upsell.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <CategoryHero
                          category={upsell.category}
                          iconName={upsell.iconName}
                          size="mini"
                        />
                      )}
                      <Badge
                        variant={upsell.active ? "default" : "secondary"}
                        className={`absolute top-2 right-2 ${upsell.active ? "bg-chart-2" : ""}`}
                      >
                        {upsell.active ? "Activo" : "Inactivo"}
                      </Badge>
                      {/* Mini-galería overlay abajo a la izquierda: 4 thumbs
                          máx + "+N" si hay más. Sólo si hay foto principal y
                          galería; sin foto principal no tendría sentido. */}
                      {upsell.heroPhoto && upsell.galleryPhotos.length > 0 && (
                        <div className="absolute bottom-2 left-2 flex gap-1">
                          {upsell.galleryPhotos.slice(0, 4).map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${upsell.id}-thumb-${i}`}
                              src={url}
                              alt=""
                              className="h-8 w-8 object-cover rounded border-2 border-white shadow"
                              loading="lazy"
                            />
                          ))}
                          {upsell.galleryPhotos.length > 4 && (
                            <div className="h-8 w-8 rounded border-2 border-white shadow bg-black/70 text-white text-xs font-bold flex items-center justify-center">
                              +{upsell.galleryPhotos.length - 4}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <CardContent className="p-6">
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
                        <Badge variant="secondary" className="text-xs">{UPSELL_CATEGORY_LABELS[upsell.category] ?? upsell.category}</Badge>
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
                  <Card key={v.id} className={`hover:shadow-md transition-all overflow-hidden ${!v.active && "opacity-60"}`}>
                    {v.heroPhoto && (
                      <div className="relative h-24 bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={v.heroPhoto}
                          alt={v.displayName ?? v.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}
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
                        {UPSELL_CATEGORY_LABELS[v.category]}
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
                          {v.defaultPricingMethod === "commission" && (
                            <>Comisión: <strong className="text-foreground">{v.commissionPercent}%</strong></>
                          )}
                          {v.defaultPricingMethod === "fixed_cost" && (
                            <>Costo unitario: <strong className="text-foreground">{formatMoney(v.defaultFixedCost ?? 0, "USD")}</strong></>
                          )}
                          {v.defaultPricingMethod === "flat_fee" && (
                            <>Fee por orden: <strong className="text-foreground">{formatMoney(v.defaultFlatFee ?? 0, "USD")}</strong></>
                          )}
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

        {/* ─── TAB 3: PEDIDOS ───────────────────────────────────────────── */}
        <TabsContent value="orders" className="mt-6">
          <OrdersTab />
        </TabsContent>

        {/* ─── TAB 4: HUB CONFIG ────────────────────────────────────────── */}
        <TabsContent value="hub-config" className="mt-6">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>Configuración de tu Host Hub</CardTitle>
              <CardDescription>
                Personaliza la página pública donde tus huéspedes pueden comprar tus experiencias y servicios independientemente de Airbnb.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* URL 1: Hub completo — propiedades + experiencias */}
              <div className="p-4 border rounded-xl bg-muted/30 space-y-3">
                <div>
                  <Label className="flex items-center gap-2">
                    <span>Hub completo</span>
                    <Badge variant="outline" className="text-[10px]">
                      Reservas Directas
                    </Badge>
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Tus propiedades + servicios extra. Compartilo con quien busca alojarse directo con vos.
                  </p>
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <p className="flex-1 text-sm font-mono text-muted-foreground bg-background border rounded-md p-2 truncate">
                    {hubUrl ?? "Cargando…"}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      disabled={!hubUrl}
                      onClick={() => copyHubUrl("full", hubUrl)}
                      title="Copiar URL al portapapeles"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {copiedKey === "full" ? "¡Copiado!" : "Copiar"}
                    </Button>
                    <Button
                      asChild={!!hubUrl}
                      disabled={!hubUrl}
                      title="Abrir el Hub completo en una pestaña nueva"
                    >
                      {hubUrl ? (
                        <a href={hubUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" /> Visitar
                        </a>
                      ) : (
                        <span>
                          <ExternalLink className="h-4 w-4 mr-2" /> Visitar
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* URL 2: Tienda Local — sin sección de propiedades */}
              <div className="p-4 border rounded-xl bg-amber-50/40 border-amber-200/60 space-y-3">
                <div>
                  <Label className="flex items-center gap-2">
                    <span>Tienda Local</span>
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] hover:bg-amber-100">
                      Sin propiedades
                    </Badge>
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Solo el catálogo de servicios y experiencias. Ideal para huéspedes que ya reservaron por Airbnb / Booking / VRBO o turistas que no se hospedan con vos.
                  </p>
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <p className="flex-1 text-sm font-mono text-muted-foreground bg-background border rounded-md p-2 truncate">
                    {hubExtrasUrl ?? "Cargando…"}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      disabled={!hubExtrasUrl}
                      onClick={() => copyHubUrl("extras", hubExtrasUrl)}
                      title="Copiar URL al portapapeles"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {copiedKey === "extras" ? "¡Copiado!" : "Copiar"}
                    </Button>
                    <Button
                      asChild={!!hubExtrasUrl}
                      disabled={!hubExtrasUrl}
                      title="Abrir la tienda de extras en una pestaña nueva"
                    >
                      {hubExtrasUrl ? (
                        <a href={hubExtrasUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" /> Visitar
                        </a>
                      ) : (
                        <span>
                          <ExternalLink className="h-4 w-4 mr-2" /> Visitar
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="hub-name">Nombre del Hub / Marca</Label>
                  <Input
                    id="hub-name"
                    value={hubName}
                    onChange={(e) => setHubName(e.target.value)}
                    placeholder="Ej: Luna Vacations Rentals"
                    maxLength={120}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Aparece como título del Hub público (header y emails al huésped).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hub-welcome">Mensaje de Bienvenida al Huésped</Label>
                  <textarea
                    id="hub-welcome"
                    value={hubWelcome}
                    onChange={(e) => setHubWelcome(e.target.value)}
                    maxLength={500}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Ej: Mejora tu estadía con nuestras actividades locales curadas por nosotros."
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {hubWelcome.length}/500 caracteres. Se muestra cerca del header del Hub.
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 py-4 border-t flex items-center gap-3">
              {hubSaved && (
                <span className="text-xs text-emerald-700 font-semibold">
                  ✓ Configuración guardada
                </span>
              )}
              <Button
                className="ml-auto gradient-gold text-white"
                disabled={hubSaving}
                onClick={saveHubConfig}
              >
                {hubSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  "Guardar Configuración"
                )}
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
            {/* Foto principal + galería. La hero se ve grande en cards y Hub;
                las de galería son adicionales (detalle, drone shots, etc.) */}
            {tenantId && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Foto principal</Label>
                  <PhotoUploader
                    pathPrefix={`${tenantId}/upsell/${editingUpsellId ?? tempUpsellId}`}
                    value={upsellForm.heroPhoto}
                    onChange={(url) => setUpsellForm({ ...upsellForm, heroPhoto: url })}
                    label="Subir foto"
                    hint="Foto principal del catamarán, buggy, etc."
                  />
                </div>

                {/* Galería adicional — hasta 5 fotos extras. Cada slot es
                    un PhotoUploader independiente. Agregar/quitar slot es
                    operación sobre el array galleryPhotos. */}
                <div className="space-y-2">
                  <Label>
                    Galería adicional ({upsellForm.galleryPhotos.length}/5)
                  </Label>
                  <div className="flex flex-wrap gap-3">
                    {upsellForm.galleryPhotos.map((url, idx) => (
                      <PhotoUploader
                        key={`gallery-${idx}`}
                        pathPrefix={`${tenantId}/upsell/${editingUpsellId ?? tempUpsellId}`}
                        value={url || null}
                        onChange={(newUrl) => {
                          setUpsellForm((prev) => {
                            const next = [...prev.galleryPhotos];
                            if (newUrl) {
                              next[idx] = newUrl;
                            } else {
                              // Foto removida → quitar el slot del array
                              next.splice(idx, 1);
                            }
                            return { ...prev, galleryPhotos: next };
                          });
                        }}
                        label={`Foto ${idx + 2}`}
                      />
                    ))}
                    {upsellForm.galleryPhotos.length < 5 && (
                      <button
                        type="button"
                        onClick={() =>
                          setUpsellForm({
                            ...upsellForm,
                            galleryPhotos: [...upsellForm.galleryPhotos, ""],
                          })
                        }
                        className="h-32 w-32 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted/60 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
                      >
                        <span className="text-2xl">+</span>
                        <span className="text-[10px] font-medium">Agregar foto</span>
                      </button>
                    )}
                  </div>
                  {upsellForm.galleryPhotos.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Opcional. Detalles, fotos drone, ambiente, etc.
                    </p>
                  )}
                </div>
              </div>
            )}

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
                  {(Object.keys(UPSELL_CATEGORY_LABELS) as UpsellCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{UPSELL_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
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

            {/* Acuerdo con vendor — solo visible si hay vendor seleccionado.
                Sin vendor el host entrega directo y no hay margen vs costo
                que calcular: vende a 100% margen. */}
            {upsellForm.vendorId && (() => {
              const selectedVendor = vendors.find((v) => v.id === upsellForm.vendorId);
              if (!selectedVendor) return null;

              // Resolución del trato efectivo: si override está OFF, usa los
              // defaults del vendor. Si ON, usa el método y valor del form.
              const effectiveMethod: VendorPricingMethod = upsellForm.overrideVendorAgreement
                ? upsellForm.vendorPricingMethod
                : selectedVendor.defaultPricingMethod;

              const effectiveValue: number = (() => {
                if (effectiveMethod === "commission") {
                  if (upsellForm.overrideVendorAgreement) {
                    return Number(upsellForm.vendorCommissionPercent) || 0;
                  }
                  return selectedVendor.commissionPercent;
                }
                if (effectiveMethod === "fixed_cost") {
                  if (upsellForm.overrideVendorAgreement) {
                    return Number(upsellForm.vendorCost) || 0;
                  }
                  return selectedVendor.defaultFixedCost ?? 0;
                }
                // flat_fee
                if (upsellForm.overrideVendorAgreement) {
                  return Number(upsellForm.vendorFlatFee) || 0;
                }
                return selectedVendor.defaultFlatFee ?? 0;
              })();

              // Margen del host por unidad vendida según el método efectivo.
              const margin: number = (() => {
                const publicPrice = Number(upsellForm.price) || 0;
                if (effectiveMethod === "commission") {
                  return (publicPrice * effectiveValue) / 100;
                }
                if (effectiveMethod === "fixed_cost") {
                  return Math.max(0, publicPrice - effectiveValue);
                }
                // flat_fee
                return Math.max(0, publicPrice - effectiveValue);
              })();

              return (
                <div className="space-y-4 p-4 border rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border-amber-200/50">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Acuerdo con {selectedVendor.displayName ?? selectedVendor.name}</h4>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={upsellForm.overrideVendorAgreement}
                        onChange={(e) =>
                          setUpsellForm({ ...upsellForm, overrideVendorAgreement: e.target.checked })
                        }
                        className="rounded"
                      />
                      Override de este producto
                    </label>
                  </div>

                  {!upsellForm.overrideVendorAgreement ? (
                    <p className="text-xs text-muted-foreground">
                      Hereda los defaults del proveedor:{" "}
                      <strong>{VENDOR_PRICING_METHOD_LABELS[selectedVendor.defaultPricingMethod]}</strong>
                      {" · "}
                      <strong>
                        {selectedVendor.defaultPricingMethod === "commission"
                          ? `${selectedVendor.commissionPercent}%`
                          : selectedVendor.defaultPricingMethod === "fixed_cost"
                            ? formatMoney(selectedVendor.defaultFixedCost ?? 0, "USD")
                            : formatMoney(selectedVendor.defaultFlatFee ?? 0, "USD")}
                      </strong>
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Cómo cobra para este producto</Label>
                        <Select
                          value={upsellForm.vendorPricingMethod}
                          onValueChange={(v) => setUpsellForm({ ...upsellForm, vendorPricingMethod: v as VendorPricingMethod })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(VENDOR_PRICING_METHOD_LABELS) as VendorPricingMethod[]).map((m) => (
                              <SelectItem key={m} value={m}>{VENDOR_PRICING_METHOD_LABELS[m]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {upsellForm.vendorPricingMethod === "commission" && (
                        <div className="space-y-1">
                          <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.commission}</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={upsellForm.vendorCommissionPercent}
                            onChange={(e) => setUpsellForm({ ...upsellForm, vendorCommissionPercent: e.target.value })}
                            placeholder={`Default vendor: ${selectedVendor.commissionPercent}%`}
                          />
                        </div>
                      )}
                      {upsellForm.vendorPricingMethod === "fixed_cost" && (
                        <div className="space-y-1">
                          <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.fixed_cost}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={upsellForm.vendorCost}
                            onChange={(e) => setUpsellForm({ ...upsellForm, vendorCost: e.target.value })}
                            placeholder={`Default vendor: ${formatMoney(selectedVendor.defaultFixedCost ?? 0, "USD")}`}
                          />
                        </div>
                      )}
                      {upsellForm.vendorPricingMethod === "flat_fee" && (
                        <div className="space-y-1">
                          <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.flat_fee}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={upsellForm.vendorFlatFee}
                            onChange={(e) => setUpsellForm({ ...upsellForm, vendorFlatFee: e.target.value })}
                            placeholder={`Default vendor: ${formatMoney(selectedVendor.defaultFlatFee ?? 0, "USD")}`}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Margen calculado en vivo */}
                  <div className="pt-3 border-t border-amber-200/50 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Tu margen por venta</span>
                      <span className="font-bold text-emerald-600">{formatMoney(margin, "USD")}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {effectiveMethod === "commission"
                        ? `${effectiveValue}% de ${formatMoney(Number(upsellForm.price) || 0, "USD")}`
                        : effectiveMethod === "fixed_cost"
                          ? `${formatMoney(Number(upsellForm.price) || 0, "USD")} público − ${formatMoney(effectiveValue, "USD")} costo`
                          : `${formatMoney(Number(upsellForm.price) || 0, "USD")} público − ${formatMoney(effectiveValue, "USD")} fee fijo`}
                    </p>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label>Icono / Visual</Label>
              <Select value={upsellForm.iconName} onValueChange={(val) => setUpsellForm({ ...upsellForm, iconName: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Icono Principal" />
                </SelectTrigger>
                <SelectContent>
                  {UPSELL_ICON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.name} value={opt.name}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sprint 5 — info del servicio que se le pedirá al huésped */}
            <div className="space-y-3 p-4 border rounded-xl bg-blue-50/30 border-blue-100">
              <div>
                <h4 className="font-medium text-sm">¿Qué necesitás saber del huésped?</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Por cada campo elegí si <strong>no se pide</strong>, es <strong>opcional</strong>{" "}
                  o <strong>obligatorio</strong>. Lo obligatorio bloquea el checkout si está vacío.
                </p>
              </div>
              <div className="space-y-3">
                {([
                  {
                    key: "timeField" as const,
                    icon: "🕒",
                    label: "Hora del servicio",
                    hint: "Ej: excursión, masaje, chef, lavandería con horario.",
                  },
                  {
                    key: "pickupField" as const,
                    icon: "📍",
                    label: "Punto de recogida",
                    hint: "Ej: excursiones desde hotel, transporte local, alquileres.",
                  },
                  {
                    key: "flightField" as const,
                    icon: "✈️",
                    label: "Número de vuelo",
                    hint: "Shuttle aeropuerto. Tracking automático con Google Flights.",
                  },
                ]).map(({ key, icon, label, hint }) => (
                  <div key={key} className="grid grid-cols-[1fr_auto] gap-3 items-center bg-white/70 rounded-md p-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">
                        {icon} {label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{hint}</p>
                    </div>
                    <Select
                      value={upsellForm[key]}
                      onValueChange={(val) =>
                        setUpsellForm({ ...upsellForm, [key]: val as UpsellFieldVisibility })
                      }
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FIELD_VISIBILITY_LABELS) as UpsellFieldVisibility[]).map((v) => (
                          <SelectItem key={v} value={v}>
                            {FIELD_VISIBILITY_LABELS[v]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="space-y-1 pt-2 border-t border-blue-100">
                <Label htmlFor="notesPlaceholder" className="text-xs">
                  💬 Notas extras del huésped (placeholder)
                </Label>
                <Input
                  id="notesPlaceholder"
                  value={upsellForm.notesPlaceholder}
                  onChange={(e) =>
                    setUpsellForm({ ...upsellForm, notesPlaceholder: e.target.value })
                  }
                  maxLength={280}
                  placeholder='Ej: "Alergias, restricciones dietéticas, preferencias..."'
                />
                <p className="text-[10px] text-muted-foreground">
                  Si lo dejás vacío, el campo de notas no se muestra al huésped. Si tipeás algo,
                  aparece como placeholder de una textarea opcional (siempre opcional).
                </p>
              </div>
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
            {tenantId && (
              <div className="space-y-2">
                <Label>Foto / logo del proveedor</Label>
                <PhotoUploader
                  pathPrefix={`${tenantId}/vendor/${editingVendorId ?? tempVendorId}`}
                  value={vendorForm.heroPhoto}
                  onChange={(url) => setVendorForm({ ...vendorForm, heroPhoto: url })}
                  label="Subir foto"
                  hint="Logo o foto representativa del vendor. Se muestra en el Hub al huésped."
                />
              </div>
            )}

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
              <Select value={vendorForm.category} onValueChange={(v) => setVendorForm({ ...vendorForm, category: v as UpsellCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(UPSELL_CATEGORY_LABELS) as UpsellCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{UPSELL_CATEGORY_LABELS[c]}</SelectItem>
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

            {/* Modelo de pricing por defecto del vendor. Cada producto puede
                override estos valores en su propio formulario. */}
            <div className="space-y-3 p-3 border rounded-xl bg-muted/20">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cómo te cobra (por defecto)
              </h5>

              <div className="space-y-2">
                <Label className="text-xs">Método</Label>
                <Select
                  value={vendorForm.defaultPricingMethod}
                  onValueChange={(v) =>
                    setVendorForm({ ...vendorForm, defaultPricingMethod: v as VendorPricingMethod })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VENDOR_PRICING_METHOD_LABELS) as VendorPricingMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>{VENDOR_PRICING_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {vendorForm.defaultPricingMethod === "commission" && (
                <div className="space-y-1">
                  <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.commission}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={vendorForm.commissionPercent}
                    onChange={(e) =>
                      setVendorForm({
                        ...vendorForm,
                        commissionPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                  />
                  <p className="text-[10px] text-muted-foreground">% que retenés del precio público</p>
                </div>
              )}
              {vendorForm.defaultPricingMethod === "fixed_cost" && (
                <div className="space-y-1">
                  <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.fixed_cost}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={vendorForm.defaultFixedCost}
                    onChange={(e) => setVendorForm({ ...vendorForm, defaultFixedCost: e.target.value })}
                    placeholder="Ej: 60"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Lo que el vendor te cobra por unidad — vos decidís el precio público.
                  </p>
                </div>
              )}
              {vendorForm.defaultPricingMethod === "flat_fee" && (
                <div className="space-y-1">
                  <Label className="text-xs">{VENDOR_PRICING_VALUE_LABEL.flat_fee}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={vendorForm.defaultFlatFee}
                    onChange={(e) => setVendorForm({ ...vendorForm, defaultFlatFee: e.target.value })}
                    placeholder="Ej: 30"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Cobro fijo por orden — sin importar precio público.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Cuándo le pagás al vendor</Label>
              <Select value={vendorForm.paymentTerms} onValueChange={(v) => setVendorForm({ ...vendorForm, paymentTerms: v as PaymentTerms })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAYMENT_TERMS_LABELS) as PaymentTerms[]).map((pt) => (
                    <SelectItem key={pt} value={pt}>{PAYMENT_TERMS_LABELS[pt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      {/* Catálogo Punta Cana — importar templates curados */}
      <UpsellTemplateCatalog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        existingNames={new Set(upsells.map((u) => u.name))}
        onImported={() => {
          void load();
        }}
      />
    </div>
  );
}
