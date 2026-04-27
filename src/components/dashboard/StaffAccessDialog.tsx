"use client";

/**
 * Diálogo de gestión de accesos cíclicos por miembro del equipo.
 *
 * Lista las propiedades a las que el staff tiene PIN cíclico, permite
 * agregar una nueva asignación con ventana horaria y revocar las
 * existentes. Cada asignación crea un PIN único en TTLock vía
 * /api/staff-access.
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, KeyRound, RefreshCw, AlertTriangle, CheckCircle2, Clock, Loader2,
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
  default_window_start: string;
  default_window_end: string;
  weekdays: number[];
  access_pin_id: string | null;
  is_active: boolean;
  notes?: string | null;
  properties?: { name?: string; address?: string };
  access_pins?: {
    pin?: string;
    sync_status?: string;
    sync_last_error?: string;
    ttlock_lock_id?: string;
    ttlock_pwd_id?: string;
  };
}

const WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  properties: PropertyOption[];
}

export function StaffAccessDialog({ open, onOpenChange, memberId, memberName, properties }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    propertyId: "",
    windowStart: "08:00",
    windowEnd: "18:00",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff-access?team_member_id=${encodeURIComponent(memberId)}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) setAssignments(data.assignments || []);
      else toast.error(data.error || "No se pudieron cargar los accesos");
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
    }
  }, [open, memberId, refresh]);

  const assignedPropertyIds = new Set(assignments.map((a) => a.property_id));
  const availableProperties = properties.filter((p) => !assignedPropertyIds.has(p.id));

  const handleAdd = async () => {
    if (!form.propertyId) {
      toast.error("Elegí una propiedad");
      return;
    }
    if (form.weekdays.length === 0) {
      toast.error("Marcá al menos un día de la semana");
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
          defaultWindowStart: form.windowStart,
          defaultWindowEnd: form.windowEnd,
          weekdays: form.weekdays,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`PIN ${data.pin} generado.`);
        setShowForm(false);
        setForm({ propertyId: "", windowStart: "08:00", windowEnd: "18:00", weekdays: [1, 2, 3, 4, 5, 6, 7] });
        await refresh();
      } else {
        toast.error(data.error || "No se pudo crear el acceso");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("¿Revocar este acceso? El PIN se borrará de la cerradura.")) return;
    try {
      const res = await fetch(`/api/staff-access/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Acceso revocado.");
        await refresh();
      } else {
        toast.error(data.error || "No se pudo revocar");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
    }
  };

  const toggleWeekday = (d: number) => {
    setForm((p) => ({
      ...p,
      weekdays: p.weekdays.includes(d) ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d].sort(),
    }));
  };

  const renderSyncBadge = (status?: string) => {
    if (!status) return <Badge variant="outline" className="text-[10px]">Sin cerradura</Badge>;
    if (status === "synced") {
      return (
        <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Activo en cerradura
        </Badge>
      );
    }
    if (status === "pending" || status === "syncing" || status === "retry") {
      return (
        <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sincronizando
        </Badge>
      );
    }
    if (status === "offline_lock") {
      return (
        <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50">
          <Clock className="h-3 w-3 mr-1" /> Cerradura offline
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] border-rose-200 text-rose-700 bg-rose-50">
        <AlertTriangle className="h-3 w-3 mr-1" /> Falló
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            Accesos de {memberName}
          </DialogTitle>
          <DialogDescription>
            PIN propio por propiedad con ventana horaria que se repite todos los días seleccionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lista de asignaciones */}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Cargando...
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Sin accesos asignados todavía. Agregá una propiedad debajo.
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => (
                <div key={a.id} className="border rounded-xl p-4 space-y-2 bg-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {a.properties?.name ?? "Propiedad"}
                      </div>
                      {a.properties?.address && (
                        <div className="text-xs text-muted-foreground truncate">{a.properties.address}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(a.id)}
                      className="text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    {a.access_pins?.pin && (
                      <div className="flex items-center gap-1.5 font-mono bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                        <KeyRound className="h-3.5 w-3.5 text-amber-600" />
                        <span className="font-bold tracking-wider">{a.access_pins.pin}</span>
                      </div>
                    )}
                    <span className="text-muted-foreground">
                      {a.default_window_start}–{a.default_window_end}
                    </span>
                    <div className="flex gap-0.5">
                      {WEEKDAY_LABELS.map((label, i) => (
                        <span
                          key={i}
                          className={
                            "inline-flex w-5 h-5 items-center justify-center rounded text-[9px] font-bold " +
                            (a.weekdays?.includes(i + 1)
                              ? "bg-violet-100 text-violet-700"
                              : "bg-slate-100 text-slate-400")
                          }
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {renderSyncBadge(a.access_pins?.sync_status)}
                  </div>

                  {a.access_pins?.sync_status === "failed" && a.access_pins.sync_last_error && (
                    <p className="text-[10px] text-rose-600 italic mt-1">
                      Error: {a.access_pins.sync_last_error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Form para agregar */}
          {!showForm && availableProperties.length > 0 && (
            <Button onClick={() => setShowForm(true)} className="w-full" variant="outline">
              <Plus className="h-4 w-4 mr-2" /> Agregar propiedad
            </Button>
          )}

          {!showForm && availableProperties.length === 0 && assignments.length > 0 && (
            <p className="text-[11px] text-center text-muted-foreground italic">
              {memberName} ya tiene acceso a todas tus propiedades.
            </p>
          )}

          {showForm && (
            <div className="border rounded-xl p-4 space-y-4 bg-violet-50/30 border-violet-200">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="time"
                    value={form.windowStart}
                    onChange={(e) => setForm((p) => ({ ...p, windowStart: e.target.value }))}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="time"
                    value={form.windowEnd}
                    onChange={(e) => setForm((p) => ({ ...p, windowEnd: e.target.value }))}
                    className="bg-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Días de la semana</Label>
                <div className="flex gap-2">
                  {WEEKDAY_LABELS.map((label, i) => {
                    const day = i + 1;
                    const active = form.weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWeekday(day)}
                        className={
                          "flex-1 h-9 rounded-lg font-bold text-xs transition " +
                          (active
                            ? "bg-violet-600 text-white border border-violet-700"
                            : "bg-white text-muted-foreground border border-slate-200 hover:bg-slate-50")
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  El PIN solo abre la cerradura los días marcados, dentro del horario.
                </p>
              </div>

              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                <Checkbox checked disabled className="mt-0.5" />
                <p className="text-[10px] text-amber-800 leading-relaxed">
                  El PIN se genera al confirmar y se envía a la cerradura automáticamente. Si la cerradura está offline, se reintenta cada 15 min.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)} disabled={submitting} className="flex-1">
                  Cancelar
                </Button>
                <Button onClick={handleAdd} disabled={submitting} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando...</>
                  ) : (
                    <>Generar PIN</>
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
