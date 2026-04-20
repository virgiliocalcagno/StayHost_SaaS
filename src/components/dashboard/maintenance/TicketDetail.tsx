"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  MessageCircle,
  Star,
  Trash2,
  Plus,
  Lock,
  Check,
  CheckCheck,
  Camera,
  ChevronsUp,
  Search,
  UserPlus,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type MaintenanceTicket,
  type MaintenanceStatus,
  type MaintenanceSeverity,
  type TicketEvent,
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_SEVERITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_ORDER,
} from "@/types/maintenance";
import {
  type ServiceVendor,
  matchesMaintenanceCategory,
  coversProperty,
} from "@/types/vendor";

const SEVERITY_COLORS: Record<MaintenanceSeverity, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-rose-100 text-rose-800 border-rose-200",
};

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  open: "bg-rose-100 text-rose-700 border-rose-200",
  awaiting_response: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed: "bg-sky-100 text-sky-700 border-sky-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  pending_verification: "bg-purple-100 text-purple-700 border-purple-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  invoiced: "bg-teal-100 text-teal-700 border-teal-200",
  closed: "bg-slate-200 text-slate-700 border-slate-300",
  dismissed: "bg-slate-100 text-slate-500 border-slate-200",
};

export interface TicketDetailProps {
  ticket: MaintenanceTicket;
  vendors: ServiceVendor[];
  onUpdate: (patch: Partial<MaintenanceTicket>) => Promise<void> | void;
  onDelete: () => void;
  onVendorCreated?: (vendor: ServiceVendor) => void;
}

export function TicketDetail({
  ticket,
  vendors,
  onUpdate,
  onDelete,
  onVendorCreated,
}: TicketDetailProps) {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [noteDraft, setNoteDraft] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/maintenance-tickets/${ticket.id}/events`, { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.events)) setEvents(data.events);
    } finally {
      setLoadingEvents(false);
    }
  }, [ticket.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // Auto-scroll al final del timeline cuando llega un evento nuevo.
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  const matchingVendors = useMemo(() => {
    return vendors.filter(
      (v) => matchesMaintenanceCategory(v, ticket.category) && coversProperty(v, ticket.propertyId)
    );
  }, [vendors, ticket.category, ticket.propertyId]);

  const selectedVendor = useMemo(
    () => (ticket.assigneeId ? vendors.find((v) => v.id === ticket.assigneeId) ?? null : null),
    [vendors, ticket.assigneeId]
  );

  // ── Logging helpers ───────────────────────────────────────────────────────
  const logEvent = useCallback(
    async (eventType: TicketEvent["eventType"], content: string, metadata: Record<string, unknown> = {}) => {
      await fetch(`/api/maintenance-tickets/${ticket.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, content, metadata }),
      });
      await loadEvents();
    },
    [ticket.id, loadEvents]
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleSendWhatsApp = async (
    vendor: ServiceVendor,
    overrideText?: string
  ) => {
    if (!vendor.phone) {
      alert("Este proveedor no tiene teléfono registrado.");
      return;
    }
    const cleanPhone = vendor.phone.replace(/\D/g, "");
    const text = overrideText ?? defaultWhatsAppMessage(ticket);
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, "_blank");

    // Registramos el evento en el timeline para que quede huella.
    await logEvent("whatsapp_sent", text, {
      phone: vendor.phone,
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      delivery_status: "sent",
    });

    // Si no había asignación o cambió, actualizar el ticket. Y avanzar estado.
    const patch: Partial<MaintenanceTicket> = {};
    if (ticket.assigneeId !== vendor.id) {
      patch.assigneeId = vendor.id;
      patch.assigneeName = vendor.name;
    }
    if (ticket.status === "open") patch.status = "awaiting_response";
    if (Object.keys(patch).length > 0) await onUpdate(patch);
  };

  const handleQuickMessage = async (template: "photo_request" | "follow_up") => {
    if (!selectedVendor) {
      alert("Primero asigná un proveedor.");
      return;
    }
    const messages = {
      photo_request: `Hola ${selectedVendor.name}, ¿podrías mandarme una foto de cómo está quedando? Gracias.`,
      follow_up: `Hola ${selectedVendor.name}, hago seguimiento del ticket en ${ticket.propertyName ?? "la propiedad"}. ¿Alguna novedad?`,
    };
    await handleSendWhatsApp(selectedVendor, messages[template]);
    if (template === "photo_request") {
      await logEvent("photo_request", "Solicitud de foto enviada", { vendor_id: selectedVendor.id });
    }
  };

  const handleEscalate = async () => {
    const reason = prompt("Motivo del escalamiento (opcional):");
    if (reason === null) return;
    await logEvent(
      "escalation",
      reason ? `Escalado: ${reason}` : "Ticket escalado a supervisor",
      { reason }
    );
  };

  const handleSaveNote = async () => {
    if (!noteDraft.trim()) return;
    setSendingNote(true);
    try {
      await logEvent("internal_note", noteDraft.trim());
      setNoteDraft("");
    } finally {
      setSendingNote(false);
    }
  };

  const handleMarkReceived = async () => {
    const reply = prompt("¿Qué respondió el proveedor? (pega el texto del WhatsApp)");
    if (!reply?.trim()) return;
    await logEvent("whatsapp_received", reply.trim(), {
      vendor_id: selectedVendor?.id ?? null,
      vendor_name: selectedVendor?.name ?? null,
    });
    if (ticket.status === "awaiting_response") {
      await onUpdate({ status: "confirmed" });
    }
  };

  return (
    <>
      {/* ── Header con título, propiedad, estado ─────────────────────────── */}
      <SheetHeader className="pb-2">
        <SheetTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          <span className="truncate">{ticket.title}</span>
        </SheetTitle>
        <SheetDescription className="text-xs">
          {ticket.propertyName || ticket.propertyId} · creado{" "}
          {new Date(ticket.createdAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
        </SheetDescription>
      </SheetHeader>

      {/* Status + severity pills + actions row */}
      <div className="flex items-center gap-2 flex-wrap pt-2 pb-3 border-b">
        <Select
          value={ticket.status}
          onValueChange={(v) => onUpdate({ status: v as MaintenanceStatus })}
        >
          <SelectTrigger className={cn("h-8 w-auto font-bold text-xs border", STATUS_COLORS[ticket.status])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MAINTENANCE_STATUS_LABELS) as MaintenanceStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{MAINTENANCE_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge className={cn("border font-bold", SEVERITY_COLORS[ticket.severity])}>
          {MAINTENANCE_SEVERITY_LABELS[ticket.severity]}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {MAINTENANCE_CATEGORY_LABELS[ticket.category]}
        </Badge>
      </div>

      {/* ── Summary compacto ─────────────────────────────────────────────── */}
      {(ticket.description || ticket.photos.length > 0) && (
        <div className="py-3 space-y-2 border-b">
          {ticket.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.description}</p>
          )}
          {ticket.photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {ticket.photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Evidencia ${i + 1}`}
                  className="rounded-xl object-cover h-20 w-20 flex-shrink-0 border border-slate-100"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Vendor assignment block ─────────────────────────────────────── */}
      <VendorAssignmentBlock
        ticket={ticket}
        vendors={vendors}
        matchingVendors={matchingVendors}
        selectedVendor={selectedVendor}
        onAssign={async (vendor) => {
          await onUpdate({ assigneeId: vendor.id, assigneeName: vendor.name });
        }}
        onSendWhatsApp={handleSendWhatsApp}
        onVendorCreated={(v) => {
          onVendorCreated?.(v);
          // Al crear, dejamos al padre recargar la lista. Asignamos inmediatamente.
          onUpdate({ assigneeId: v.id, assigneeName: v.name });
        }}
      />

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      {selectedVendor && (
        <div className="flex gap-2 overflow-x-auto py-3 border-b">
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedVendor && handleSendWhatsApp(selectedVendor)}
            className="flex-shrink-0"
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1" /> Re-enviar WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage("photo_request")}
            className="flex-shrink-0"
          >
            <Camera className="h-3.5 w-3.5 mr-1" /> Pedir foto
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkReceived}
            className="flex-shrink-0"
          >
            <Check className="h-3.5 w-3.5 mr-1" /> Marcar respondió
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEscalate}
            className="flex-shrink-0 text-rose-600 hover:bg-rose-50"
          >
            <ChevronsUp className="h-3.5 w-3.5 mr-1" /> Escalar
          </Button>
        </div>
      )}

      {/* ── Timeline (corazón del help desk) ─────────────────────────────── */}
      <div className="py-4 space-y-3">
        <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Historial</h5>
        {loadingEvents ? (
          <p className="text-xs text-slate-400 italic">Cargando historial…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Sin eventos aún.</p>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => (
              <TimelineEvent key={ev.id} event={ev} />
            ))}
            <div ref={timelineEndRef} />
          </div>
        )}
      </div>

      {/* ── Sticky bottom bar: input nota + delete ───────────────────────── */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t mt-4 -mx-6 px-6 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Escribir nota interna… (solo la ve tu equipo)"
            className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSaveNote();
              }
            }}
          />
          <Button
            onClick={handleSaveNote}
            disabled={!noteDraft.trim() || sendingNote}
            size="icon"
            className="h-11 w-11 gradient-gold text-primary-foreground flex-shrink-0"
            title="Guardar nota (Ctrl+Enter)"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" /> Nota interna · Ctrl+Enter para enviar
          </span>
          <button
            onClick={onDelete}
            className="text-rose-500 hover:text-rose-700 flex items-center gap-1 font-semibold"
          >
            <Trash2 className="h-3 w-3" /> Eliminar ticket
          </button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Timeline event rendering
// ───────────────────────────────────────────────────────────────────────────

function TimelineEvent({ event }: { event: TicketEvent }) {
  const time = new Date(event.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(event.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

  // Eventos del sistema: status_change, assignment, created → banner centrado gris
  if (event.eventType === "status_change" || event.eventType === "assignment" || event.eventType === "created") {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-slate-100 text-slate-600 text-[11px] font-semibold px-3 py-1 rounded-full">
          {event.content ?? event.eventType} · {date} {time}
        </div>
      </div>
    );
  }

  // WhatsApp enviado → burbuja verde a la derecha
  if (event.eventType === "whatsapp_sent") {
    const status = (event.metadata?.delivery_status as string) ?? "sent";
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-emerald-500 text-white rounded-2xl rounded-tr-md px-3 py-2 shadow-sm">
          <p className="text-xs whitespace-pre-wrap">{event.content}</p>
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-emerald-100">
            <span>{time}</span>
            {status === "read" ? (
              <CheckCheck className="h-3 w-3 text-sky-200" />
            ) : status === "delivered" ? (
              <CheckCheck className="h-3 w-3" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // WhatsApp recibido → burbuja blanca a la izquierda
  if (event.eventType === "whatsapp_received") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-md px-3 py-2 shadow-sm">
          {(event.metadata?.vendor_name as string) && (
            <p className="text-[10px] font-bold text-emerald-600 mb-0.5">
              {event.metadata.vendor_name as string}
            </p>
          )}
          <p className="text-xs whitespace-pre-wrap">{event.content}</p>
          <p className="text-[10px] text-slate-400 mt-1 text-right">{time}</p>
        </div>
      </div>
    );
  }

  // Nota interna → burbuja amarilla
  if (event.eventType === "internal_note") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] bg-amber-50 border border-amber-200 text-slate-800 rounded-2xl px-3 py-2">
          <div className="flex items-center gap-1 mb-1">
            <Lock className="h-3 w-3 text-amber-600" />
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Interna</span>
            {event.actorName && <span className="text-[10px] text-slate-500">· {event.actorName}</span>}
          </div>
          <p className="text-xs whitespace-pre-wrap">{event.content}</p>
          <p className="text-[10px] text-slate-400 mt-1">{time}</p>
        </div>
      </div>
    );
  }

  // Escalation, photo_request → banner de color
  if (event.eventType === "escalation") {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-rose-100 text-rose-700 text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <ChevronsUp className="h-3 w-3" /> {event.content ?? "Escalado"} · {time}
        </div>
      </div>
    );
  }

  if (event.eventType === "photo_request") {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-sky-100 text-sky-700 text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <Camera className="h-3 w-3" /> {event.content} · {time}
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-[11px] text-slate-500 italic">
      {event.eventType}: {event.content} · {time}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Vendor assignment with inline "Add new"
// ───────────────────────────────────────────────────────────────────────────

interface VendorAssignmentBlockProps {
  ticket: MaintenanceTicket;
  vendors: ServiceVendor[];
  matchingVendors: ServiceVendor[];
  selectedVendor: ServiceVendor | null;
  onAssign: (vendor: ServiceVendor) => Promise<void> | void;
  onSendWhatsApp: (vendor: ServiceVendor) => Promise<void> | void;
  onVendorCreated: (vendor: ServiceVendor) => void;
}

function VendorAssignmentBlock({
  ticket,
  vendors,
  matchingVendors,
  selectedVendor,
  onAssign,
  onSendWhatsApp,
  onVendorCreated,
}: VendorAssignmentBlockProps) {
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

  // Si la query no está vacía, buscamos también en TODOS los vendors (no solo
  // los que matchean la categoría) para permitir escalar a uno de otra
  // categoría si hace falta.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? vendors : matchingVendors;
    if (!q) return pool;
    return pool.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.phone ?? "").includes(q) ||
        v.subcategories.some((sc) => sc.toLowerCase().includes(q))
    );
  }, [query, vendors, matchingVendors]);

  const handleCreateAndAssign = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim(),
          type: "maintenance",
          subcategories: [ticket.category],
          active: true,
        }),
      });
      if (!res.ok) {
        alert("No se pudo crear el proveedor. Verificá los datos.");
        return;
      }
      const { vendor } = await res.json();
      onVendorCreated(vendor as ServiceVendor);
      setNewName("");
      setNewPhone("");
      setQuery("");
      setShowAddForm(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="py-3 border-b space-y-3 bg-emerald-50/20 -mx-6 px-6">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
          <MessageCircle className="h-3.5 w-3.5" /> Proveedor asignado
        </Label>
        {selectedVendor && (
          <button
            onClick={() => onAssign({ ...selectedVendor, id: "" } as ServiceVendor)}
            className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center gap-1"
            title="Quitar asignación"
          >
            <X className="h-3 w-3" /> Quitar
          </button>
        )}
      </div>

      {selectedVendor ? (
        <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-emerald-200">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1">
              {selectedVendor.isPreferred && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
              {selectedVendor.name}
            </p>
            {selectedVendor.phone && (
              <p className="text-xs text-slate-500">{selectedVendor.phone}</p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => onSendWhatsApp(selectedVendor)}
            disabled={!selectedVendor.phone}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
          </Button>
        </div>
      ) : (
        <>
          {/* Buscador */}
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar proveedor… (${matchingVendors.length} cubren esta categoría)`}
              className="pl-9"
            />
          </div>

          {/* Resultados */}
          {!showAddForm && (
            <div className="max-h-52 overflow-y-auto space-y-1">
              {results.length === 0 ? (
                <p className="text-xs text-slate-400 italic px-2 py-2">
                  Sin resultados{query ? ` para "${query}"` : ""}.
                </p>
              ) : (
                results.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onAssign(v)}
                    className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-white text-left transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 flex items-center gap-1">
                        {v.isPreferred && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                        {v.name}
                        {!matchingVendors.includes(v) && (
                          <Badge variant="outline" className="text-[9px] ml-1">otro tipo</Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {v.phone ?? "sin teléfono"} · {v.subcategories.join(", ") || "sin subcategorías"}
                      </p>
                    </div>
                  </button>
                ))
              )}

              {/* Botón "+ Agregar" siempre visible al final si hay query */}
              <button
                onClick={() => {
                  setNewName(query);
                  setShowAddForm(true);
                }}
                className="w-full flex items-center gap-2 p-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm font-bold"
              >
                <UserPlus className="h-4 w-4" />
                {query ? `Agregar "${query}" como nuevo proveedor` : "Agregar un proveedor nuevo"}
              </button>
            </div>
          )}

          {/* Inline create form */}
          {showAddForm && (
            <div className="p-3 rounded-xl bg-white border border-emerald-200 space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Nuevo proveedor
                </h5>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre"
                autoFocus
              />
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+18091234567"
                inputMode="tel"
              />
              <p className="text-[10px] text-slate-500">
                Se creará con categoría <strong>{MAINTENANCE_CATEGORY_LABELS[ticket.category]}</strong> y
                quedará asignado a este ticket automáticamente. Podés completar más datos luego desde
                <strong> Proveedores</strong>.
              </p>
              <Button
                onClick={handleCreateAndAssign}
                disabled={!newName.trim() || !newPhone.trim() || creating}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {creating ? "Creando…" : "Crear y asignar"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function defaultWhatsAppMessage(ticket: MaintenanceTicket): string {
  const lines = [
    `*Nuevo pedido de mantenimiento — StayHost*`,
    ``,
    `🏠 *Propiedad:* ${ticket.propertyName || ticket.propertyId}`,
    `⚠️ *Problema:* ${ticket.title}`,
    `📋 *Categoría:* ${MAINTENANCE_CATEGORY_LABELS[ticket.category]}`,
    `🔥 *Severidad:* ${MAINTENANCE_SEVERITY_LABELS[ticket.severity]}`,
  ];
  if (ticket.description) {
    lines.push(``, `*Detalles:*`, ticket.description);
  }
  if (ticket.photos.length > 0) {
    lines.push(``, `📷 *Fotos:*`);
    ticket.photos.forEach((url) => lines.push(url));
  }
  lines.push(``, `Por favor confirmá disponibilidad. ¡Gracias!`);
  return lines.join("\n");
}

// Silence unused warnings for exports we may want to use later.
export { MAINTENANCE_STATUS_ORDER };
