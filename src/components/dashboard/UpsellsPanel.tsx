"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import type { Upsell, UpsellCategory } from "@/types/upsell";
import { UPSELL_DEFAULT_ICON } from "@/types/upsell";
import type { ServiceVendor } from "@/types/vendor";

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

// State del form. Mantiene los campos editables del Upsell + flags para
// distinguir create vs edit. Currency lo dejo siempre USD (convención del
// SaaS — solo PayoutsPanel es multi-moneda).
interface FormState {
  name: string;
  description: string;
  price: number;
  category: UpsellCategory;
  iconName: string;
  isGlobal: boolean;
  linkedPropertyIds: string[];
  vendorId: string | null;
  active: boolean;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  price: 0,
  category: "service",
  iconName: "Sparkles",
  isGlobal: true,
  linkedPropertyIds: [],
  vendorId: null,
  active: true,
};

export default function UpsellsPanel() {
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [vendors, setVendors] = useState<ServiceVendor[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);

  // Carga inicial: catálogo + vendors + properties. En paralelo para no
  // bloquear el render. Si vendors o properties fallan, el panel sigue
  // funcionando — el usuario ve "Sin proveedor" en el dropdown.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [upsellsRes, vendorsRes, propsRes] = await Promise.all([
        fetch("/api/upsells", { cache: "no-store", credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/vendors?active=true", { cache: "no-store", credentials: "include" })
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

  // Stats agregados a partir del catálogo real. Sales/revenue arrancan en 0
  // hasta que conectemos el flujo de órdenes en sprints siguientes.
  const stats = useMemo(() => {
    const activeUpsells = upsells.filter((u) => u.active);
    const totalRevenue = upsells.reduce((s, u) => s + u.revenue, 0);
    const totalSales = upsells.reduce((s, u) => s + u.salesCount, 0);
    return {
      revenue: totalRevenue,
      salesCount: totalSales,
      activeCount: activeUpsells.length,
    };
  }, [upsells]);

  const getIconComponent = (name: string) => {
    const Icon = iconsMap[name] || Sparkles;
    return <Icon className="h-6 w-6 text-primary" />;
  };

  const vendorName = (vendorId: string | null): string | null => {
    if (!vendorId) return null;
    return vendors.find((v) => v.id === vendorId)?.name ?? null;
  };

  const handleAddNew = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setIsSheetOpen(true);
  };

  const handleEdit = (u: Upsell) => {
    setEditingId(u.id);
    setFormData({
      name: u.name,
      description: u.description ?? "",
      price: u.price,
      category: u.category,
      iconName: u.iconName,
      isGlobal: u.isGlobal,
      linkedPropertyIds: u.linkedPropertyIds,
      vendorId: u.vendorId,
      active: u.active,
    });
    setIsSheetOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este producto del catálogo?")) return;
    const res = await fetch(`/api/upsells?id=${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setUpsells((prev) => prev.filter((u) => u.id !== id));
    }
  };

  // Save: POST si crea, PATCH si edita. Después de OK refrescamos el item
  // (no toda la lista) para que la UI quede consistente sin doble fetch.
  const handleSave = async () => {
    if (saving) return; // guard contra doble click si la red está lenta
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description || null,
        price: Number(formData.price) || 0,
        category: formData.category,
        iconName: formData.iconName,
        isGlobal: formData.isGlobal,
        linkedPropertyIds: formData.isGlobal ? [] : formData.linkedPropertyIds,
        vendorId: formData.vendorId,
        active: formData.active,
      };

      if (editingId) {
        const res = await fetch(`/api/upsells?id=${editingId}`, {
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
        // Aplico el patch local para no esperar otro fetch.
        setUpsells((prev) =>
          prev.map((u) =>
            u.id === editingId
              ? {
                  ...u,
                  name: payload.name,
                  description: payload.description,
                  price: payload.price,
                  category: payload.category,
                  iconName: payload.iconName,
                  isGlobal: payload.isGlobal,
                  linkedPropertyIds: payload.linkedPropertyIds,
                  vendorId: payload.vendorId,
                  active: payload.active,
                }
              : u,
          ),
        );
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
      setIsSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // Si cambia la categoría en el form y el icono actual es genérico (Sparkles)
  // o coincidía con el default de la categoría anterior, sugerimos el default
  // de la nueva categoría — pero sin pisar elecciones explícitas del usuario.
  const updateCategory = (next: UpsellCategory) => {
    setFormData((prev) => {
      const wasDefault = prev.iconName === UPSELL_DEFAULT_ICON[prev.category];
      return {
        ...prev,
        category: next,
        iconName: wasDefault ? UPSELL_DEFAULT_ICON[next] : prev.iconName,
      };
    });
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
        <TabsList className="grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="inventory">Inventario de Servicios</TabsTrigger>
          <TabsTrigger value="hub-config">Configuración Host Hub</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-6 mt-6">
          {/* Stats Bar */}
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
            <Button onClick={handleAddNew} className="gradient-gold text-primary-foreground gap-2">
              <Plus className="h-4 w-4" />
              Nuevo producto
            </Button>
          </div>

          {/* Products Grid */}
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

                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-2xl font-bold">{formatMoney(upsell.price, "USD")}</span>
                          <span className="text-muted-foreground text-sm"> / unidad</span>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-4 flex-wrap">
                        {upsell.isGlobal ? (
                          <Badge variant="outline" className="text-xs bg-muted/50 border-primary/20 text-primary">
                            <Store className="h-3 w-3 mr-1" /> Venta Global
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-muted/50">
                            <MapPin className="h-3 w-3 mr-1" /> {upsell.linkedPropertyIds.length} propiedad{upsell.linkedPropertyIds.length === 1 ? "" : "es"}
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
                        <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => handleEdit(upsell)}>
                          <Edit className="h-4 w-4 text-muted-foreground" />
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white" onClick={() => handleDelete(upsell.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Add New Visual Card */}
              <Card onClick={handleAddNew} className="border-dashed cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
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
                  <p className="text-sm font-mono text-primary flex items-center bg-background border rounded-md p-2 mt-2 w-full truncate">
                    https://stayhost.com/hub/luna-rentals
                  </p>
                </div>
                <div className="flex gap-2 md:mt-6 shrink-0">
                  <Button variant="outline"><Copy className="h-4 w-4 mr-2" /> Copiar</Button>
                  <Button><ExternalLink className="h-4 w-4 mr-2" /> Visitar</Button>
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
              {/* Configuración del Hub aún no persiste en BD — botón
                  deshabilitado para no engañar al usuario con un "Guardar"
                  que no hace nada. Llega en Sprint 2 (conexión a
                  tenants.hub_welcome_message y similar). */}
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

      {/* Editor Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>{editingId ? "Editar Producto" : "Nuevo Producto"}</SheetTitle>
            <SheetDescription>
              Configura los detalles de esta experiencia o servicio adicional.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Producto</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ej: Catamarán Bávaro Beach"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">Descripción Breve</Label>
              <textarea
                id="desc"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Qué incluye, duración, qué llevar…"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Precio (US$)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    id="price"
                    className="pl-8"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={formData.category} onValueChange={(val) => updateCategory(val as UpsellCategory)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">🔧 Servicio (Ej. Limpieza)</SelectItem>
                    <SelectItem value="experience">🌴 Experiencia (Ej. Tour)</SelectItem>
                    <SelectItem value="food">🍽️ Gastronomía</SelectItem>
                    <SelectItem value="transport">🚗 Transporte</SelectItem>
                    <SelectItem value="other">📦 Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Proveedor (opcional)</Label>
              <Select
                value={formData.vendorId ?? "_none"}
                onValueChange={(val) => setFormData({ ...formData, vendorId: val === "_none" ? null : val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor — lo entrego yo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin proveedor — lo entrego yo</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} {v.phone ? `· ${v.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Quién despacha este servicio. Si no hay vendor, lo entregás vos.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Icono / Visual</Label>
              <Select value={formData.iconName} onValueChange={(val) => setFormData({ ...formData, iconName: val })}>
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
              <h4 className="font-medium text-sm text-foreground">Disponibilidad de Venta</h4>
              <div className="flex flex-col space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input
                    type="radio"
                    name="isGlobal"
                    checked={formData.isGlobal === true}
                    onChange={() => setFormData({ ...formData, isGlobal: true })}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">✨ Venta Global (Host Hub)</strong>
                    <span className="text-muted-foreground text-xs block">Se vende abierto en tu Hub público, no requiere reserva activa.</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-md">
                  <input
                    type="radio"
                    name="isGlobal"
                    checked={formData.isGlobal === false}
                    onChange={() => setFormData({ ...formData, isGlobal: false })}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    <strong className="block font-medium">🏠 Vinculado a Propiedades</strong>
                    <span className="text-muted-foreground text-xs block">Solo se ofrece a huéspedes de las propiedades elegidas (Ej: Early Check-in).</span>
                  </span>
                </label>
              </div>

              {!formData.isGlobal && (
                <div className="mt-4 space-y-2 pt-4 border-t border-border">
                  <Label>Aplica a estas propiedades:</Label>
                  {properties.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No hay propiedades cargadas todavía.</p>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {properties.map((prop) => {
                        const checked = formData.linkedPropertyIds.includes(prop.id);
                        return (
                          <label key={prop.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/30 px-2 py-1 rounded">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setFormData((prev) => ({
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
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
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
            <Button onClick={handleSave} disabled={saving || !formData.name.trim()} className="gradient-gold">
              {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear producto"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
