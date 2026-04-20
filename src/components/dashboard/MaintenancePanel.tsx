"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertTriangle,
  Wrench,
  Plus,
  Filter,
  Clock,
  CheckCircle2,
  X,
  ImageIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type MaintenanceTicket,
  type MaintenanceCategory,
  type MaintenanceSeverity,
  type MaintenanceStatus,
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_SEVERITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
} from "@/types/maintenance";

const SEVERITY_COLORS: Record<MaintenanceSeverity, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-rose-100 text-rose-800 border-rose-200",
};

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  open: "bg-rose-100 text-rose-700 border-rose-200",
  in_progress: "bg-sky-100 text-sky-700 border-sky-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-500 border-slate-200",
};

type Property = { id: string; name: string | null };

export default function MaintenancePanel() {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<MaintenanceStatus | "all">("all");
  const [filterProperty, setFilterProperty] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<MaintenanceSeverity | "all">("all");

  const [openTicket, setOpenTicket] = useState<MaintenanceTicket | null>(null);
  const [openCreate, setOpenCreate] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/maintenance-tickets", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.tickets)) setTickets(data.tickets);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProperties = useCallback(async () => {
    try {
      const res = await fetch("/api/properties", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.properties)) {
        setProperties(
          data.properties.map((p: { id: string; name: string | null }) => ({
            id: p.id,
            name: p.name,
          }))
        );
      }
    } catch {/* silencioso */}
  }, []);

  useEffect(() => {
    void loadTickets();
    void loadProperties();
  }, [loadTickets, loadProperties]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (filterProperty !== "all" && t.propertyId !== filterProperty) return false;
      if (filterSeverity !== "all" && t.severity !== filterSeverity) return false;
      return true;
    });
  }, [tickets, filterStatus, filterProperty, filterSeverity]);

  const counts = useMemo(() => {
    const c: Record<MaintenanceStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      dismissed: 0,
    };
    tickets.forEach((t) => { c[t.status]++; });
    return c;
  }, [tickets]);

  const handleUpdate = async (id: string, patch: Partial<MaintenanceTicket>) => {
    const body: Record<string, unknown> = {};
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.severity !== undefined) body.severity = patch.severity;
    if (patch.category !== undefined) body.category = patch.category;
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.assigneeId !== undefined) body.assigneeId = patch.assigneeId;
    if (patch.assigneeName !== undefined) body.assigneeName = patch.assigneeName;
    if (patch.resolutionNotes !== undefined) body.resolutionNotes = patch.resolutionNotes;
    const res = await fetch(`/api/maintenance-tickets?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await loadTickets();
      // refresh open ticket if applicable
      setOpenTicket((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/maintenance-tickets?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      await loadTickets();
      setOpenTicket(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="h-6 w-6 text-rose-600" />
            Mantenimiento
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tickets reportados desde limpieza o creados manualmente.
          </p>
        </div>
        <Button
          onClick={() => setOpenCreate(true)}
          className="gradient-gold text-primary-foreground"
        >
          <Plus className="w-4 h-4 mr-2" /> Nuevo ticket
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Abiertos" count={counts.open} icon={AlertTriangle} color="text-rose-600 bg-rose-50" />
        <StatCard label="En progreso" count={counts.in_progress} icon={Clock} color="text-sky-600 bg-sky-50" />
        <StatCard label="Resueltos" count={counts.resolved} icon={CheckCircle2} color="text-emerald-600 bg-emerald-50" />
        <StatCard label="Descartados" count={counts.dismissed} icon={X} color="text-slate-500 bg-slate-100" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 text-sm text-slate-600 font-semibold">
            <Filter className="h-4 w-4" /> Filtros
          </div>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as MaintenanceStatus | "all")}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {(Object.keys(MAINTENANCE_STATUS_LABELS) as MaintenanceStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{MAINTENANCE_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSeverity} onValueChange={(v) => setFilterSeverity(v as MaintenanceSeverity | "all")}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Severidad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(Object.keys(MAINTENANCE_SEVERITY_LABELS) as MaintenanceSeverity[]).map((s) => (
                <SelectItem key={s} value={s}>{MAINTENANCE_SEVERITY_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterProperty} onValueChange={setFilterProperty}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Propiedad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las propiedades</SelectItem>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-2">
        {loading ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando tickets…</CardContent></Card>
        ) : filteredTickets.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <Wrench className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">Sin tickets que coincidan con el filtro.</p>
            </CardContent>
          </Card>
        ) : (
          filteredTickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpenTicket(t)}
              className="w-full text-left"
            >
              <Card className="hover:border-primary/30 hover:shadow-md transition-all">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    t.severity === "critical" ? "bg-rose-100" : "bg-slate-100"
                  )}>
                    <AlertTriangle className={cn(
                      "h-5 w-5",
                      t.severity === "critical" ? "text-rose-600" : "text-slate-500"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-800 truncate">{t.title}</h4>
                      <Badge className={cn("border font-bold text-[10px]", STATUS_COLORS[t.status])}>
                        {MAINTENANCE_STATUS_LABELS[t.status]}
                      </Badge>
                      <Badge className={cn("border font-bold text-[10px]", SEVERITY_COLORS[t.severity])}>
                        {MAINTENANCE_SEVERITY_LABELS[t.severity]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                      <span className="font-semibold">{t.propertyName || t.propertyId.slice(0, 8)}</span>
                      <span>•</span>
                      <span>{MAINTENANCE_CATEGORY_LABELS[t.category]}</span>
                      {t.reportedByName && (
                        <>
                          <span>•</span>
                          <span>Reportó: {t.reportedByName}</span>
                        </>
                      )}
                      {t.photos.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> {t.photos.length}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 flex-shrink-0">
                    {new Date(t.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))
        )}
      </div>

      {/* Detail sheet */}
      <Sheet open={!!openTicket} onOpenChange={(o) => !o && setOpenTicket(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openTicket && (
            <TicketDetail
              ticket={openTicket}
              onUpdate={(patch) => handleUpdate(openTicket.id, patch)}
              onDelete={() => handleDelete(openTicket.id)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create sheet */}
      <Sheet open={openCreate} onOpenChange={setOpenCreate}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <CreateTicketForm
            properties={properties}
            onCreated={async () => {
              setOpenCreate(false);
              await loadTickets();
            }}
            onCancel={() => setOpenCreate(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  count,
  icon: Icon,
  color,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-black">{count}</p>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TicketDetail({
  ticket,
  onUpdate,
  onDelete,
}: {
  ticket: MaintenanceTicket;
  onUpdate: (patch: Partial<MaintenanceTicket>) => void;
  onDelete: () => void;
}) {
  const [resolutionNotes, setResolutionNotes] = useState(ticket.resolutionNotes ?? "");

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          {ticket.title}
        </SheetTitle>
        <SheetDescription>
          {ticket.propertyName || ticket.propertyId} — creado {new Date(ticket.createdAt).toLocaleString("es-ES")}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge className={cn("border font-bold", STATUS_COLORS[ticket.status])}>
            {MAINTENANCE_STATUS_LABELS[ticket.status]}
          </Badge>
          <Badge className={cn("border font-bold", SEVERITY_COLORS[ticket.severity])}>
            {MAINTENANCE_SEVERITY_LABELS[ticket.severity]}
          </Badge>
          <Badge variant="outline">{MAINTENANCE_CATEGORY_LABELS[ticket.category]}</Badge>
        </div>

        {ticket.description && (
          <div>
            <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Descripción</Label>
            <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{ticket.description}</p>
          </div>
        )}

        {ticket.reportedByName && (
          <div className="text-xs text-slate-500">
            Reportado por <strong>{ticket.reportedByName}</strong>
            {ticket.cleaningTaskId && <> desde tarea de limpieza</>}
          </div>
        )}

        {ticket.photos.length > 0 && (
          <div>
            <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2 block">
              Evidencia ({ticket.photos.length})
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {ticket.photos.map((url, i) => (
                <img key={i} src={url} alt={`Evidencia ${i + 1}`} className="rounded-xl object-cover aspect-square" />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Cambiar estado</Label>
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(MAINTENANCE_STATUS_LABELS) as MaintenanceStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={ticket.status === s ? "default" : "outline"}
                onClick={() => onUpdate({ status: s })}
              >
                {MAINTENANCE_STATUS_LABELS[s]}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Asignado a</Label>
          <Input
            value={ticket.assigneeName ?? ""}
            onChange={(e) => onUpdate({ assigneeName: e.target.value })}
            placeholder="Nombre del técnico o responsable"
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Notas de resolución</Label>
          <Textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            onBlur={() => {
              if (resolutionNotes !== (ticket.resolutionNotes ?? "")) {
                onUpdate({ resolutionNotes });
              }
            }}
            placeholder="Qué se hizo, costo, proveedor, etc."
            className="mt-1 min-h-[80px]"
          />
        </div>

        <div className="pt-4 border-t flex justify-between">
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-4 w-4 mr-1" /> Eliminar
          </Button>
        </div>
      </div>
    </>
  );
}

function CreateTicketForm({
  properties,
  onCreated,
  onCancel,
}: {
  properties: Property[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>("other");
  const [severity, setSeverity] = useState<MaintenanceSeverity>("medium");
  const [saving, setSaving] = useState(false);

  // Keep propertyId in sync when list arrives after mount.
  useEffect(() => {
    if (!propertyId && properties[0]) setPropertyId(properties[0].id);
  }, [properties, propertyId]);

  const handleSubmit = async () => {
    if (!title.trim() || !propertyId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/maintenance-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          title: title.trim(),
          description: description.trim() || null,
          category,
          severity,
        }),
      });
      if (res.ok) onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Nuevo ticket de mantenimiento</SheetTitle>
        <SheetDescription>Crea manualmente un ticket para una propiedad.</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-4">
        <div>
          <Label>Propiedad</Label>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar propiedad" /></SelectTrigger>
            <SelectContent>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Cerradura del baño atascada" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Categoría</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MAINTENANCE_CATEGORY_LABELS) as MaintenanceCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>{MAINTENANCE_CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severidad</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as MaintenanceSeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MAINTENANCE_SEVERITY_LABELS) as MaintenanceSeverity[]).map((s) => (
                  <SelectItem key={s} value={s}>{MAINTENANCE_SEVERITY_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Descripción</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles, ubicación, proveedor sugerido…"
            className="min-h-[100px]"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !propertyId || saving}
            className="flex-1 gradient-gold text-primary-foreground"
          >
            {saving ? "Creando…" : "Crear ticket"}
          </Button>
        </div>
      </div>
    </>
  );
}
