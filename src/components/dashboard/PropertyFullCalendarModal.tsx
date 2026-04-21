"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Lock,
  Calendar as CalendarIcon,
  User,
  Phone,
  Hash,
  FileText,
  LogIn,
  LogOut,
  Sparkles,
  Clock,
  AlertTriangle,
} from "lucide-react";

// Local date helpers — nunca UTC para evitar shift nocturno.
const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const parseLocalDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const todayStr = () => toLocalDateStr(new Date());
const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};
const monthLabel = (d: Date) =>
  d.toLocaleDateString("es", { month: "long", year: "numeric" });

type Booking = {
  id: string;
  guest: string;
  channel?: string | null;
  status?: string | null;
  start: string;
  end: string;
  numGuests?: number | null;
  note?: string | null;
  phone?: string | null;
  phoneLast4?: string | null;
  channelCode?: string | null;
  totalPrice?: number | null;
  sourceUid?: string | null;
};

// CleaningTask — coincide con el shape devuelto por /api/cleaning-tasks.
type CleaningTask = {
  id: string;
  propertyId: string;
  dueDate: string;            // YYYY-MM-DD
  dueTime?: string | null;    // HH:MM
  status: string;             // pending | assigned | in_progress | accepted | declined | completed | ...
  priority: string;           // low | medium | high | critical
  guestName?: string | null;
  guestCount?: number | null;
  assigneeName?: string | null;
  isBackToBack?: boolean;
  arrivingGuestName?: string | null;
};

type Property = {
  id: string | number;
  name: string;
  channel?: string | null;
  bookings: Booking[];
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property: Property | null;
  onCreateBookingForRange?: (propertyId: string | number, start: string, end: string) => void;
};

// Un booking cruza el dia d si start <= d < end (check_out es exclusive).
const bookingOnDay = (b: Booking, dayStr: string) =>
  b.start <= dayStr && dayStr < b.end;

const isBlockBooking = (b: Booking) =>
  b.channel === "block" || b.status === "blocked";

const isManualBlock = (b: Booking) =>
  isBlockBooking(b) && typeof b.sourceUid === "string" && b.sourceUid.startsWith("manual-");

const blockOriginLabel = (b: Booking): string => {
  if (!isBlockBooking(b) || isManualBlock(b)) return "";
  const uid = b.sourceUid ?? "";
  if (uid.includes("airbnb")) return "Airbnb";
  if (uid.includes("vrbo")) return "VRBO";
  if (uid.includes("booking")) return "Booking";
  return "iCal";
};

const channelDotClass = (channel?: string | null) => {
  switch (channel) {
    case "airbnb": return "bg-rose-500";
    case "booking": return "bg-blue-600";
    case "vrbo": return "bg-indigo-500";
    default: return "bg-emerald-500";
  }
};

// Pill base styles — la misma logica de color que el MultiCalendario
// semanal (rose/blue/indigo/emerald por canal, amber pending, tramas para bloqueos).
const pillClass = (b: Booking) => {
  if (isBlockBooking(b)) {
    return isManualBlock(b)
      ? "text-black border border-yellow-600 bg-[repeating-linear-gradient(45deg,#facc15,#facc15_6px,#1f2937_6px,#1f2937_12px)]"
      : "text-white border border-slate-300 bg-[repeating-linear-gradient(45deg,#64748b,#64748b_5px,#94a3b8_5px,#94a3b8_10px)]";
  }
  if (b.status !== "confirmed") {
    return "bg-amber-500 text-amber-950 border border-amber-400";
  }
  switch (b.channel) {
    case "airbnb": return "bg-rose-500 text-white border border-white/20";
    case "booking": return "bg-blue-600 text-white border border-white/20";
    case "vrbo": return "bg-indigo-500 text-white border border-white/20";
    default: return "bg-emerald-500 text-white border border-white/20";
  }
};

const pillLabel = (b: Booking) => {
  if (isBlockBooking(b)) {
    return isManualBlock(b) ? "Bloqueo manual" : `Bloqueo ${blockOriginLabel(b)}`;
  }
  return b.guest;
};

// Estilo de pill para una tarea de limpieza, color segun prioridad.
// Critical = back-to-back (check-out y check-in mismo dia) → rojo.
// High/medium/low → cyan, violeta, slate. Completadas → desaturadas.
const taskPillClass = (t: CleaningTask) => {
  const done = t.status === "completed" || t.status === "accepted";
  if (done) return "bg-slate-200 text-slate-600 border border-slate-300 line-through";
  if (t.priority === "critical" || t.isBackToBack) {
    return "bg-red-500 text-white border border-red-600";
  }
  if (t.priority === "high") return "bg-orange-500 text-white border border-orange-600";
  return "bg-cyan-500 text-white border border-cyan-600";
};

const taskPillLabel = (t: CleaningTask) => {
  const time = t.dueTime ?? "";
  const who = t.assigneeName ? ` · ${t.assigneeName}` : "";
  return `${time} Limpieza${who}`;
};

export default function PropertyFullCalendarModal({
  open,
  onOpenChange,
  property,
  onCreateBookingForRange,
}: Props) {
  // Mes visible (siempre primer dia del mes a las 00:00 local).
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Rango seleccionado por clicks en celdas libres: start (requerido),
  // end (opcional — si null, el range es 1 dia).
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Tareas de limpieza de ESTA propiedad. Se cargan al abrir el modal y
  // se refrescan cuando llega el evento "stayhost:bookings-updated" o
  // "stayhost:cleaning-updated" (por si otro panel cambio algo).
  const [tasks, setTasks] = useState<CleaningTask[]>([]);

  // Al abrir el modal, resetear seleccion.
  useEffect(() => {
    if (open) {
      setSelectedBookingId(null);
      setSelectedTaskId(null);
      setRangeStart(null);
      setRangeEnd(null);
      setBlockNote("");
    }
  }, [open, property?.id]);

  // Fetch de tareas de limpieza de la propiedad actual.
  useEffect(() => {
    if (!open || !property) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    const propId = String(property.id);
    const load = async () => {
      try {
        const res = await fetch("/api/cleaning-tasks", { credentials: "same-origin" });
        const data = await res.json();
        if (cancelled) return;
        const all: CleaningTask[] = Array.isArray(data.tasks) ? data.tasks : [];
        setTasks(all.filter((t) => String(t.propertyId) === propId));
      } catch {
        if (!cancelled) setTasks([]);
      }
    };
    load();
    const onUpdated = () => load();
    window.addEventListener("stayhost:bookings-updated", onUpdated);
    window.addEventListener("stayhost:cleaning-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("stayhost:bookings-updated", onUpdated);
      window.removeEventListener("stayhost:cleaning-updated", onUpdated);
    };
  }, [open, property?.id, property]);

  const weekdays = useMemo(() => ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"], []);

  // Grid de 42 celdas (6 semanas) empezando desde el Lunes de la semana
  // que contiene el dia 1 del mes. Algunas celdas seran del mes anterior
  // o siguiente — las renderizamos apagadas.
  const gridDays = useMemo(() => {
    const first = new Date(cursor);
    // getDay: 0=Dom, 1=Lun ... 6=Sab. Queremos que Lun sea el inicio.
    const dow = first.getDay();
    const offsetToMonday = dow === 0 ? 6 : dow - 1;
    const start = addDays(first, -offsetToMonday);
    const days: { date: Date; str: string; inMonth: boolean; isToday: boolean }[] = [];
    const today = todayStr();
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const str = toLocalDateStr(d);
      days.push({
        date: d,
        str,
        inMonth: d.getMonth() === cursor.getMonth(),
        isToday: str === today,
      });
    }
    return days;
  }, [cursor]);

  const bookings = property?.bookings ?? [];
  const selectedBooking = selectedBookingId
    ? bookings.find((b) => String(b.id) === selectedBookingId) ?? null
    : null;
  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const rangeLabel = (() => {
    if (!rangeStart) return null;
    const end = rangeEnd ?? rangeStart;
    return { start: rangeStart, end };
  })();

  const goPrevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const goToday = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    setCursor(d);
  };

  const handleDayClick = useCallback(
    (dayStr: string, bookingsOnDay: Booking[]) => {
      // Si el dia tiene una reserva (no bloqueo), seleccionamos esa al primer click.
      const firstBooking = bookingsOnDay[0];
      if (firstBooking) {
        setSelectedBookingId(String(firstBooking.id));
        setRangeStart(null);
        setRangeEnd(null);
        return;
      }
      // Dia libre: primera vez setea start, segunda vez setea end.
      setSelectedBookingId(null);
      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(dayStr);
        setRangeEnd(null);
      } else {
        // rangeStart existe, rangeEnd null → seteamos end (ordenado).
        if (dayStr < rangeStart) {
          setRangeEnd(rangeStart);
          setRangeStart(dayStr);
        } else if (dayStr === rangeStart) {
          // mismo dia clickeado → range = 1 dia (start..start+1 cuando apliquemos)
          setRangeEnd(dayStr);
        } else {
          setRangeEnd(dayStr);
        }
      }
    },
    [rangeStart, rangeEnd],
  );

  const handleSaveBlock = async () => {
    if (!property || !rangeStart) return;
    // end exclusive en check_out: si el usuario selecciono 10..12, el bloqueo
    // dura 10 y 11. Si selecciono solo 10, el bloqueo dura 10.
    const startIso = rangeStart;
    const endInclusive = rangeEnd ?? rangeStart;
    const endIso = toLocalDateStr(addDays(parseLocalDate(endInclusive), 1));
    setSaving(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          propertyId: String(property.id),
          checkIn: startIso,
          checkOut: endIso,
          source: "block",
          note: blockNote || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.warning(
          "Bloqueo guardado. Acordate de entrar a Airbnb → Calendario → Importar ahora para evitar overbooking.",
          { duration: 10000 },
        );
        setRangeStart(null);
        setRangeEnd(null);
        setBlockNote("");
        // Dispara el refresh en el panel padre.
        window.dispatchEvent(new CustomEvent("stayhost:bookings-updated"));
      } else {
        toast.error(data.error ?? "No se pudo guardar el bloqueo.");
      }
    } catch {
      toast.error("Error de conexion al guardar el bloqueo.");
    }
    setSaving(false);
  };

  const handleCreateBookingClick = () => {
    if (!property || !rangeStart || !onCreateBookingForRange) return;
    const endInclusive = rangeEnd ?? rangeStart;
    const checkOutIso = toLocalDateStr(addDays(parseLocalDate(endInclusive), 1));
    onCreateBookingForRange(property.id, rangeStart, checkOutIso);
    onOpenChange(false);
  };

  // Stats del mes actual (para el panel cuando no hay seleccion).
  const monthStats = useMemo(() => {
    const monthStartStr = toLocalDateStr(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const monthEndStr = toLocalDateStr(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    let reservas = 0;
    let bloqueos = 0;
    let nightsBooked = 0;
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    for (const b of bookings) {
      // Solape con el mes actual.
      if (b.end <= monthStartStr || b.start >= monthEndStr) continue;
      if (b.status === "cancelled") continue;
      if (isBlockBooking(b)) bloqueos++;
      else reservas++;
      // Contamos noches dentro del mes.
      const ovStart = b.start > monthStartStr ? b.start : monthStartStr;
      const ovEnd = b.end < monthEndStr ? b.end : monthEndStr;
      const ov = Math.round(
        (parseLocalDate(ovEnd).getTime() - parseLocalDate(ovStart).getTime()) / 86400000,
      );
      if (ov > 0) nightsBooked += ov;
    }
    const occupancy = Math.round((nightsBooked / daysInMonth) * 100);
    // Tareas de limpieza del mes (por dueDate).
    const tasksMonth = tasks.filter(
      (t) => t.dueDate >= monthStartStr && t.dueDate < monthEndStr,
    ).length;
    return { reservas, bloqueos, nightsBooked, daysInMonth, occupancy, tasks: tasksMonth };
  }, [bookings, tasks, cursor]);

  if (!property) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(1400px,95vw)] w-[95vw] h-[92vh] p-0 rounded-2xl overflow-hidden flex flex-col bg-card"
      >
        {/* Header */}
        <div className="h-16 px-6 border-b flex items-center gap-4 shrink-0 bg-background/80 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-sm", channelDotClass(property.channel))}>
              {(property.name?.[0] ?? "P").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-black text-sm truncate">{property.name}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                Calendario completo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={goPrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[180px] text-center">
              <p className="font-black capitalize">{monthLabel(cursor)}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={goNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 ml-2 rounded-xl" onClick={goToday}>
              Hoy
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Grid */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Weekday header */}
            <div className="grid grid-cols-7 border-b bg-muted/30">
              {weekdays.map((w) => (
                <div key={w} className="h-9 flex items-center justify-center text-[10px] uppercase tracking-widest font-black text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 grid-rows-6 flex-1 overflow-auto divide-x divide-y divide-border/40 border-t-0">
              {gridDays.map((d) => {
                const onDay = bookings.filter(
                  (b) => b.status !== "cancelled" && bookingOnDay(b, d.str),
                );
                const tasksDay = tasks.filter((t) => t.dueDate === d.str);
                const isInRange = (() => {
                  if (!rangeStart) return false;
                  const end = rangeEnd ?? rangeStart;
                  const lo = rangeStart < end ? rangeStart : end;
                  const hi = rangeStart < end ? end : rangeStart;
                  return d.str >= lo && d.str <= hi;
                })();
                const isRangeStart = d.str === rangeStart;
                const isRangeEnd = d.str === (rangeEnd ?? rangeStart) && rangeStart !== null;

                return (
                  <div
                    key={d.str}
                    onClick={() => handleDayClick(d.str, onDay)}
                    className={cn(
                      "min-h-[90px] p-1.5 flex flex-col gap-1 cursor-pointer transition-colors relative group",
                      !d.inMonth && "bg-muted/10 text-muted-foreground/60",
                      d.inMonth && "hover:bg-primary/[0.04]",
                      isInRange && "bg-primary/10 ring-1 ring-inset ring-primary/40",
                      (isRangeStart || isRangeEnd) && "bg-primary/20",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "text-[11px] font-black w-6 h-6 flex items-center justify-center rounded-full",
                          d.isToday && "bg-rose-600 text-white",
                          !d.isToday && d.inMonth && "text-foreground/80",
                        )}
                      >
                        {d.date.getDate()}
                      </span>
                      {onDay.length + tasksDay.length > 2 && (
                        <span className="text-[9px] text-muted-foreground font-bold">
                          +{onDay.length + tasksDay.length - 2}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {onDay.slice(0, 2).map((b) => (
                        <div
                          key={b.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBookingId(String(b.id));
                            setSelectedTaskId(null);
                            setRangeStart(null);
                            setRangeEnd(null);
                          }}
                          className={cn(
                            "h-5 px-1.5 rounded text-[10px] font-bold truncate flex items-center gap-1 shadow-sm",
                            pillClass(b),
                            selectedBookingId === String(b.id) && "ring-2 ring-foreground/80",
                          )}
                        >
                          {isBlockBooking(b) && <Lock className="h-2.5 w-2.5 shrink-0" />}
                          <span className="truncate">{pillLabel(b)}</span>
                        </div>
                      ))}
                      {tasksDay.slice(0, Math.max(0, 2 - onDay.length)).map((t) => (
                        <div
                          key={t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTaskId(t.id);
                            setSelectedBookingId(null);
                            setRangeStart(null);
                            setRangeEnd(null);
                          }}
                          className={cn(
                            "h-5 px-1.5 rounded text-[10px] font-bold truncate flex items-center gap-1 shadow-sm",
                            taskPillClass(t),
                            selectedTaskId === t.id && "ring-2 ring-foreground/80",
                          )}
                        >
                          <Sparkles className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{taskPillLabel(t)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side panel */}
          <aside className="w-[340px] border-l bg-muted/20 shrink-0 overflow-y-auto">
            {selectedBooking ? (
              <BookingDetailPanel booking={selectedBooking} onClose={() => setSelectedBookingId(null)} />
            ) : selectedTask ? (
              <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} />
            ) : rangeStart ? (
              <RangeActionPanel
                start={rangeStart}
                end={rangeEnd ?? rangeStart}
                note={blockNote}
                setNote={setBlockNote}
                onSaveBlock={handleSaveBlock}
                onCreateBooking={onCreateBookingForRange ? handleCreateBookingClick : undefined}
                saving={saving}
                onClear={() => {
                  setRangeStart(null);
                  setRangeEnd(null);
                  setBlockNote("");
                }}
              />
            ) : (
              <MonthSummaryPanel
                stats={monthStats}
                monthText={monthLabel(cursor)}
              />
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── sub-panels ─────────────

function BookingDetailPanel({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const block = isBlockBooking(booking);
  const manual = isManualBlock(booking);
  const origin = blockOriginLabel(booking);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider",
          block
            ? manual
              ? "bg-yellow-100 text-yellow-900 border border-yellow-400"
              : "bg-slate-100 text-slate-700 border border-slate-300"
            : booking.status === "confirmed"
              ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
              : "bg-amber-100 text-amber-900 border border-amber-300",
        )}>
          {block
            ? manual ? "Bloqueo manual" : `Bloqueo ${origin}`
            : booking.status === "confirmed" ? "Confirmada" : "Pendiente"}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!block && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
            Huesped
          </p>
          <p className="text-lg font-black leading-tight">{booking.guest}</p>
          {booking.channel && (
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">Canal: {booking.channel}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1 flex items-center gap-1">
            <LogIn className="h-3 w-3" /> Check-in
          </p>
          <p className="text-sm font-bold">{booking.start}</p>
        </div>
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1 flex items-center gap-1">
            <LogOut className="h-3 w-3" /> Check-out
          </p>
          <p className="text-sm font-bold">{booking.end}</p>
        </div>
      </div>

      {!block && booking.numGuests != null && (
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-bold">{booking.numGuests}</span>
          <span className="text-muted-foreground">huespedes</span>
        </div>
      )}

      {!block && booking.channelCode && (
        <div className="flex items-center gap-2 text-sm">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono font-bold">{booking.channelCode}</span>
        </div>
      )}

      {!block && booking.phone && (
        <div className="flex items-center gap-2 text-sm">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <span>{booking.phone}</span>
        </div>
      )}

      {booking.note && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 flex items-center gap-1">
            <FileText className="h-3 w-3" /> Nota
          </p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{booking.note}</p>
        </div>
      )}

      {block && !manual && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-700 leading-relaxed">
          Este bloqueo vino de <strong>{origin}</strong>. Para editarlo o quitarlo,
          hacelo en {origin}. Aca solo se sincroniza.
        </div>
      )}
    </div>
  );
}

function RangeActionPanel({
  start,
  end,
  note,
  setNote,
  onSaveBlock,
  onCreateBooking,
  saving,
  onClear,
}: {
  start: string;
  end: string;
  note: string;
  setNote: (v: string) => void;
  onSaveBlock: () => void;
  onCreateBooking?: () => void;
  saving: boolean;
  onClear: () => void;
}) {
  const single = start === end;
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
          Rango seleccionado
        </p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-xl bg-background p-3 border flex items-center gap-3">
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          {single ? (
            <p className="text-sm font-bold">{start}</p>
          ) : (
            <p className="text-sm font-bold">
              {start} <span className="text-muted-foreground font-normal">→</span> {end}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            {single
              ? "Click en otro dia para extender el rango"
              : "Click en otro dia libre para cambiar el inicio"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
          Nota (opcional)
        </Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Mantenimiento, uso personal..."
          rows={2}
          className="text-xs resize-none"
        />
      </div>

      <div className="space-y-2">
        <Button
          onClick={onSaveBlock}
          disabled={saving}
          className="w-full h-11 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Guardando...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 mr-2" /> Bloquear rango
            </>
          )}
        </Button>
        {onCreateBooking && (
          <Button
            onClick={onCreateBooking}
            variant="outline"
            className="w-full h-11 rounded-xl"
          >
            Crear reserva directa en este rango
          </Button>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground leading-relaxed p-3 rounded-lg bg-yellow-50 border border-yellow-200">
        ⚠️ Al bloquear, el iCal exportado se actualiza en la proxima sincronizacion
        (cada 30 min). Para evitar overbooking durante la ventana, entra a
        Airbnb → Calendario → Importar ahora.
      </div>
    </div>
  );
}

function MonthSummaryPanel({
  stats,
  monthText,
}: {
  stats: { reservas: number; bloqueos: number; nightsBooked: number; daysInMonth: number; occupancy: number; tasks: number };
  monthText: string;
}) {
  return (
    <div className="p-5 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-wider font-black text-muted-foreground mb-1">
          Resumen del mes
        </p>
        <p className="text-lg font-black capitalize">{monthText}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1">
            Reservas
          </p>
          <p className="text-2xl font-black">{stats.reservas}</p>
        </div>
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1">
            Bloqueos
          </p>
          <p className="text-2xl font-black">{stats.bloqueos}</p>
        </div>
        <div className="rounded-xl bg-cyan-50 p-3 border border-cyan-200">
          <p className="text-[9px] uppercase tracking-wider text-cyan-700 font-black mb-1 flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5" /> Limp.
          </p>
          <p className="text-2xl font-black text-cyan-700">{stats.tasks}</p>
        </div>
      </div>

      <div className="rounded-xl bg-background p-4 border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-black mb-2">
          Ocupacion
        </p>
        <div className="flex items-end gap-2">
          <p className="text-3xl font-black leading-none">{stats.occupancy}%</p>
          <p className="text-[10px] text-muted-foreground mb-1">
            {stats.nightsBooked}/{stats.daysInMonth} noches
          </p>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600"
            style={{ width: `${Math.min(100, stats.occupancy)}%` }}
          />
        </div>
      </div>

      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-[11px] text-primary/80 leading-relaxed">
        💡 Haz <strong>click en un dia libre</strong> para bloquearlo o crear una reserva directa.
        <br />
        Haz <strong>click en una reserva o limpieza</strong> para ver los detalles.
      </div>
    </div>
  );
}

function TaskDetailPanel({ task, onClose }: { task: CleaningTask; onClose: () => void }) {
  const done = task.status === "completed" || task.status === "accepted";
  const critical = task.priority === "critical" || task.isBackToBack;
  const statusLabel = (() => {
    switch (task.status) {
      case "pending": return "Pendiente";
      case "unassigned": return "Sin asignar";
      case "assigned": return "Asignada";
      case "accepted": return "Aceptada";
      case "declined": return "Rechazada";
      case "in_progress": return "En curso";
      case "completed": return "Completada";
      default: return task.status;
    }
  })();
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-100 text-cyan-900 border border-cyan-300">
          <Sparkles className="h-3 w-3" /> Limpieza
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
          Fecha y hora
        </p>
        <div className="flex items-baseline gap-2">
          <p className="text-lg font-black">{task.dueDate}</p>
          {task.dueTime && (
            <p className="text-sm text-muted-foreground font-bold flex items-center gap-1">
              <Clock className="h-3 w-3" /> {task.dueTime}
            </p>
          )}
        </div>
      </div>

      {critical && (
        <div className="rounded-lg bg-red-50 border border-red-300 p-2.5 flex items-start gap-2 text-[11px] text-red-800 leading-relaxed">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-black uppercase tracking-wide">Back-to-back</p>
            <p>Check-out y check-in el mismo dia. La limpieza tiene ventana cerrada.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1">
            Estado
          </p>
          <p className={cn("text-sm font-bold", done && "text-emerald-700")}>
            {statusLabel}
          </p>
        </div>
        <div className="rounded-xl bg-background p-3 border">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-black mb-1">
            Prioridad
          </p>
          <p className={cn(
            "text-sm font-bold capitalize",
            critical && "text-red-700",
            task.priority === "high" && "text-orange-700",
          )}>
            {task.priority}
          </p>
        </div>
      </div>

      {task.assigneeName && (
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-bold">{task.assigneeName}</span>
        </div>
      )}

      {task.guestName && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
            Huesped que se va
          </p>
          <p className="text-sm font-bold">
            {task.guestName}
            {task.guestCount ? ` · ${task.guestCount} huespedes` : ""}
          </p>
        </div>
      )}

      {task.arrivingGuestName && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
            Huesped que llega (mismo dia)
          </p>
          <p className="text-sm font-bold">
            {task.arrivingGuestName}
            {task.arrivingGuestCount ? ` · ${task.arrivingGuestCount} huespedes` : ""}
          </p>
        </div>
      )}

      <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-[11px] text-muted-foreground leading-relaxed">
        Para gestionar el checklist, asignar o validar fotos, entra al modulo
        <strong> Limpiezas</strong>. Aca se muestra solo el resumen.
      </div>
    </div>
  );
}
