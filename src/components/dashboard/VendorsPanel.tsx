"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Users,
  Plus,
  Star,
  Phone,
  Mail,
  MessageCircle,
  Trash2,
  Wrench,
  Package,
  Briefcase,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ServiceVendor,
  type VendorType,
  VENDOR_TYPE_LABELS,
  VENDOR_SUBCATEGORIES,
} from "@/types/vendor";

const TYPE_ICONS: Record<VendorType, React.ElementType> = {
  maintenance: Wrench,
  supplies: Package,
  services: Briefcase,
  utilities: Zap,
};

const TYPE_COLORS: Record<VendorType, string> = {
  maintenance: "text-rose-600 bg-rose-50",
  supplies: "text-emerald-600 bg-emerald-50",
  services: "text-sky-600 bg-sky-50",
  utilities: "text-amber-600 bg-amber-50",
};

export default function VendorsPanel() {
  const [vendors, setVendors] = useState<ServiceVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<VendorType | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [openVendor, setOpenVendor] = useState<ServiceVendor | null>(null);
  const [openCreate, setOpenCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.vendors)) setVendors(data.vendors);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      if (filterType !== "all" && v.type !== filterType) return false;
      if (!showInactive && !v.active) return false;
      return true;
    });
  }, [vendors, filterType, showInactive]);

  const handleSave = async (id: string, patch: Partial<ServiceVendor>) => {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.phone !== undefined) body.phone = patch.phone;
    if (patch.email !== undefined) body.email = patch.email;
    if (patch.type !== undefined) body.type = patch.type;
    if (patch.subcategories !== undefined) body.subcategories = patch.subcategories;
    if (patch.propertiesScope !== undefined) body.propertiesScope = patch.propertiesScope;
    if (patch.notes !== undefined) body.notes = patch.notes;
    if (patch.rating !== undefined) body.rating = patch.rating;
    if (patch.active !== undefined) body.active = patch.active;
    if (patch.isPreferred !== undefined) body.isPreferred = patch.isPreferred;
    const res = await fetch(`/api/vendors?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await load();
      setOpenVendor((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este proveedor?")) return;
    const res = await fetch(`/api/vendors?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      await load();
      setOpenVendor(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Proveedores
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Directorio transversal: técnicos, insumos, servicios profesionales y utilities.
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)} className="gradient-gold text-primary-foreground">
          <Plus className="w-4 h-4 mr-2" /> Nuevo proveedor
        </Button>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterType === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterType("all")}
        >
          Todos ({vendors.filter((v) => showInactive || v.active).length})
        </Button>
        {(Object.keys(VENDOR_TYPE_LABELS) as VendorType[]).map((t) => {
          const Icon = TYPE_ICONS[t];
          const count = vendors.filter((v) => v.type === t && (showInactive || v.active)).length;
          return (
            <Button
              key={t}
              variant={filterType === t ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterType(t)}
            >
              <Icon className="h-4 w-4 mr-1.5" />
              {VENDOR_TYPE_LABELS[t]} ({count})
            </Button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(v === true)}
          />
          <label htmlFor="show-inactive" className="text-slate-600 font-medium cursor-pointer">
            Mostrar inactivos
          </label>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No hay proveedores que coincidan.</p>
            <Button variant="outline" onClick={() => setOpenCreate(true)} className="mt-4">
              <Plus className="w-4 h-4 mr-1" /> Agregar el primero
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((v) => {
            const Icon = TYPE_ICONS[v.type];
            return (
              <button key={v.id} onClick={() => setOpenVendor(v)} className="text-left">
                <Card className={cn("hover:shadow-md hover:border-primary/30 transition-all h-full", !v.active && "opacity-60")}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0", TYPE_COLORS[v.type])}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-800 truncate">{v.name}</h4>
                          {v.isPreferred && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                          {!v.active && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {VENDOR_TYPE_LABELS[v.type]}
                          {v.subcategories.length > 0 && ` · ${v.subcategories.slice(0, 2).map(sc => labelFor(v.type, sc)).join(", ")}${v.subcategories.length > 2 ? "…" : ""}`}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                          {v.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{v.phone}</span>}
                          {v.email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{v.email}</span>}
                        </div>
                        {v.rating !== null && v.rating !== undefined && (
                          <div className="flex items-center gap-1 mt-1">
                            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                            <span className="text-xs font-bold text-slate-600">{v.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {/* Edit sheet */}
      <Sheet open={!!openVendor} onOpenChange={(o) => !o && setOpenVendor(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openVendor && (
            <VendorForm
              mode="edit"
              initial={openVendor}
              onSave={(patch) => handleSave(openVendor.id, patch)}
              onDelete={() => handleDelete(openVendor.id)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create sheet */}
      <Sheet open={openCreate} onOpenChange={setOpenCreate}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <VendorForm
            mode="create"
            onCreate={async (v) => {
              const res = await fetch("/api/vendors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(v),
              });
              if (res.ok) {
                setOpenCreate(false);
                await load();
              }
            }}
            onCancel={() => setOpenCreate(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function labelFor(type: VendorType, value: string): string {
  return VENDOR_SUBCATEGORIES[type].find((s) => s.value === value)?.label ?? value;
}

// ────────────────────────────────────────────────────────────────────────────

type VendorFormProps =
  | {
      mode: "edit";
      initial: ServiceVendor;
      onSave: (patch: Partial<ServiceVendor>) => void;
      onDelete: () => void;
    }
  | {
      mode: "create";
      onCreate: (v: Partial<ServiceVendor>) => Promise<void>;
      onCancel: () => void;
    };

function VendorForm(props: VendorFormProps) {
  const initial = props.mode === "edit" ? props.initial : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [type, setType] = useState<VendorType>(initial?.type ?? "maintenance");
  const [subcategories, setSubcategories] = useState<string[]>(initial?.subcategories ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rating, setRating] = useState<string>(initial?.rating != null ? String(initial.rating) : "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [isPreferred, setIsPreferred] = useState(initial?.isPreferred ?? false);
  const [saving, setSaving] = useState(false);

  const availableSubcats = VENDOR_SUBCATEGORIES[type];

  const toggleSubcat = (value: string) => {
    setSubcategories((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  };

  const payload = (): Partial<ServiceVendor> => ({
    name: name.trim(),
    phone: phone.trim() || null,
    email: email.trim() || null,
    type,
    subcategories,
    notes: notes.trim() || null,
    rating: rating ? Number(rating) : null,
    active,
    isPreferred,
  });

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (props.mode === "create") {
        await props.onCreate(payload());
      } else {
        props.onSave(payload());
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {props.mode === "create" ? "Nuevo proveedor" : initial?.name}
        </SheetTitle>
        <SheetDescription>
          {props.mode === "create"
            ? "Agregar un nuevo contacto al directorio."
            : "Edita los datos del proveedor."}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-4">
        <div>
          <Label>Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Juan el Plomero" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => { setType(v as VendorType); setSubcategories([]); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(VENDOR_TYPE_LABELS) as VendorType[]).map((t) => (
                  <SelectItem key={t} value={t}>{VENDOR_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rating (1-5)</Label>
            <Input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>

        <div>
          <Label>Subcategorías</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {availableSubcats.map((sc) => {
              const selected = subcategories.includes(sc.value);
              return (
                <Button
                  key={sc.value}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSubcat(sc.value)}
                >
                  {sc.label}
                </Button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Un proveedor puede cubrir varias subcategorías. Si no seleccionás ninguna, se considera que cubre todas.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teléfono</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+569XXXXXXXX"
            />
            <p className="text-[11px] text-slate-400 mt-1">Formato internacional para WhatsApp.</p>
          </div>
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </div>
        </div>

        <div>
          <Label>Notas</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Dirección, horarios, forma de pago, referencia de quién lo recomendó…"
            className="min-h-[80px]"
          />
        </div>

        <div className="flex items-center gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
            <span className="font-medium">Activo</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isPreferred} onCheckedChange={(v) => setIsPreferred(v === true)} />
            <span className="font-medium flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-amber-500" /> Favorito (se sugiere primero)
            </span>
          </label>
        </div>

        <div className="flex gap-3 pt-4 border-t">
          {props.mode === "edit" ? (
            <>
              <Button
                variant="ghost"
                onClick={props.onDelete}
                className="text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Eliminar
              </Button>
              <div className="flex-1" />
              {phone && (
                <Button
                  variant="outline"
                  onClick={() => window.open(`https://wa.me/${phone.replace(/\D/g, "")}`, "_blank")}
                >
                  <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || saving}
                className="gradient-gold text-primary-foreground"
              >
                Guardar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={props.onCancel} className="flex-1">Cancelar</Button>
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || saving}
                className="flex-1 gradient-gold text-primary-foreground"
              >
                {saving ? "Creando…" : "Crear"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
