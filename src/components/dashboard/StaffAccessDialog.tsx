"use client";

/**
 * Diálogo de asignación de PINs de acceso por miembro del equipo.
 *
 * Modelo: PIN fijo guardado por staff/propiedad. Solo se sube a la
 * cerradura cuando se asigna una tarea de limpieza. Ventana global
 * 8am-6pm del día de la tarea.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, KeyRound, RefreshCw, Loader2, Info,
} from "lucide-react";
import { toast } from "sonner";

interface PropertyOption {
  id: string;
  name: string;
}

interface Assignment {
  id: string;
  team_member_id: string;
  property_id: string;
  pin_code: string;
  is_active: boolean;
  notes?: string | null;
  properties?: { name?: string; address?: string };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  properties: PropertyOption[];
}

export function StaffAccessDialog({ open, onOpenChange, memberId, memberName, properties }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [windowGlobal, setWindowGlobal] = useState({ start: "08:00", end: "18:00" });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fetchedProperties, setFetchedProperties] = useState<PropertyOption[]>([]);
  const effectiveProperties = properties.length > 0 ? properties : fetchedProperties;

  const [form, setForm] = useState({ propertyId: "", pinCode: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff-access?team_member_id=${encodeURIComponent(memberId)}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) {
        setAssignments(data.assignments || []);
        if (data.defaultWindow) setWindowGlobal(data.defaultWindow);
      } else {
        toast.error(data.error || "No se pudieron cargar los accesos");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    if (open && memberId) {
      refresh();
      setShowForm(false);
      setForm({ propertyId: "", pinCode: "" });
    }
  }, [open, memberId, refresh]);

  useEffect(() => {
    if (!open || properties.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/properties", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json() as { properties?: Array<{ id: string; name: string }> };
        if (!cancelled) {
          setFetchedProperties((data.properties ?? []).map((p) => ({ id: p.id, name: p.name })));
        }
      } catch {
        // no-op
      }
    })();
    return () => { cancelled = true; };
  }, [open, properties.length]);

  const assignedPropertyIds = new Set(assignments.map((a) => a.property_id));
  const availableProperties = effectiveProperties.filter((p) => !assignedPropertyIds.has(p.id));

  const handleAdd = async () => {
    if (!form.propertyId) {
      toast.error("Elegí una propiedad");
      return;
    }
    if (form.pinCode && !/^\d{4,8}$/.test(form.pinCode)) {
      toast.error("El PIN debe tener entre 4 y 8 dígitos");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/staff-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          teamMemberId: memberId,
          propertyId: form.propertyId,
          pinCode: form.pinCode || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`PIN ${data.pinCode} guardado.`);
        setShowForm(false);
        setForm({ propertyId: "", pinCode: "" });
        await refresh();
      } else {
        toast.error(data.error || "No se pudo guardar la asignación");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar esta asignación? Si hay un PIN activo en la cerradura, se revoca.")) return;
    try {
      const res = await fetch(`/api/staff-access/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Asignación borrada.");
        await refresh();
      } else {
        toast.error(data.error || "No se pudo borrar");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            Accesos de {memberName}
          </DialogTitle>
          <DialogDescription>
            Cada propiedad tiene un PIN fijo. Se activa en la cerradura solo cuando le asignás una tarea de limpieza.
          </DialogDescription>
        </DialogHeader>

        {/* Info de ventana global */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            El PIN abre la cerradura <strong>solo el día de la tarea</strong>, entre las{" "}
            <strong>{windowGlobal.start}</strong> y las <strong>{windowGlobal.end}</strong>. Fuera de ese horario o sin tarea asignada, no funciona.
          </p>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Cargando...
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Sin asignaciones todavía. Agregá una propiedad debajo.
            </div>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="border rounded-xl p-3 flex items-center justify-between gap-3 bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{a.properties?.name ?? "Propiedad"}</div>
                    {a.properties?.address && (
                      <div className="text-xs text-muted-foreground truncate">{a.properties.address}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 font-mono bg-amber-50 border border-amber-200 px-2.5 py-1 rounded">
                    <KeyRound className="h-3.5 w-3.5 text-amber-600" />
                    <span className="font-bold tracking-wider text-sm">{a.pin_code}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(a.id)}
                    className="text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!showForm && availableProperties.length > 0 && (
            <Button onClick={() => setShowForm(true)} className="w-full" variant="outline">
              <Plus className="h-4 w-4 mr-2" /> Agregar propiedad
            </Button>
          )}

          {!showForm && availableProperties.length === 0 && assignments.length > 0 && (
            <p className="text-[11px] text-center text-muted-foreground italic">
              {memberName} ya tiene PIN asignado en todas tus propiedades.
            </p>
          )}

          {showForm && (
            <div className="border rounded-xl p-4 space-y-4 bg-amber-50/30 border-amber-200">
              <div className="space-y-2">
                <Label className="text-xs">Propiedad</Label>
                <Select
                  value={form.propertyId}
                  onValueChange={(v) => setForm((p) => ({ ...p, propertyId: v }))}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Elegí una propiedad..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProperties.map((prop) => (
                      <SelectItem key={prop.id} value={prop.id}>{prop.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">PIN (4-8 dígitos, opcional)</Label>
                <Input
                  placeholder="Dejá vacío para generar uno aleatorio"
                  value={form.pinCode}
                  onChange={(e) => setForm((p) => ({ ...p, pinCode: e.target.value.replace(/\D/g, "") }))}
                  maxLength={8}
                  className="bg-white font-mono tracking-widest"
                />
                <p className="text-[10px] text-muted-foreground italic">
                  Es el código que la persona usará siempre en esa propiedad. Recomendado: 6 dígitos memorables (ej. fecha de cumpleaños).
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)} disabled={submitting} className="flex-1">
                  Cancelar
                </Button>
                <Button onClick={handleAdd} disabled={submitting} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Guardando...</>
                  ) : (
                    <>Guardar PIN</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
