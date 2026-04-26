"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
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
};

type Property = {
  id: string | number;
  name: string;
  channel?: string | null;
  bookings: Booking[];
  // Horarios definidos por el host. Defaults industry-standard: 14:00 in,
  // 12:00 out. El calendario los muestra en las pills de salida/entrada
  // para comunicar visualmente que el dia de check-out queda libre desde
  // esa hora (back-to-back posible).
  checkInTime?: string | null;
  checkOutTime?: string | null;
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

// Pill desaturada para indicar "este huesped sale hoy a HH:MM" en el dia
// de check-out. Convencion estilo Airbnb / iGMS: el dia de salida queda
// libre desde la hora del checkout — esta pill comunica que la manana
// sigue ocupada y la tarde esta disponible para back-to-back. Color en
// version diluida del canal para no competir con las reservas activas.
const checkoutPillClass = (b: Booking) => {
  if (b.status !== "confirmed") {
    return "bg-amber-50 text-amber-800 border-amber-300";
  }
  switch (b.channel) {
    case "airbnb": return "bg-rose-50 text-rose-700 border-rose-300";
    case "booking": return "bg-blue-50 text-blue-700 border-blue-300";
    case "vrbo": return "bg-indigo-50 text-indigo-700 border-indigo-300";
    default: return "bg-emerald-50 text-emerald-700 border-emerald-300";
  }
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
  // Mes que el usuario esta viendo en el scroll — actualizado en vivo por
  // el IntersectionObserver sobre cada bloque de mes. Refleja el mes cuyo
  // titulo esta mas arriba en el viewport (mismo comportamiento que Airbnb).
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Rango de meses apilados verticalmente: 6 atras, 18 adelante (2 años
  // totales). Cubre planificacion tipica sin renderizar demasiado.
  const months = useMemo(() => {
    const now = new Date();
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    const out: Date[] = [];
    for (let i = -6; i <= 18; i++) {
      out.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
    }
    return out;
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const todayCellRef = useRef<HTMLDivElement | null>(null);
  const monthRefs = useRef<Map<string, HTMLElement>>(new Map());

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Rango seleccionado por clicks en celdas libres: start (requerido),
  // end (opcional — si null, el range es 1 dia).
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Drag-to-select: cuando el usuario apreta el mouse en un dia libre y
  // lo arrastra sobre otras celdas, el rango se va actualizando en vivo.
  // Si suelta sin moverse, es un click normal (primera click de range,
  // luego click-click sigue funcionando como siempre).
  // `dragAnchor` guarda el dia donde empezo el drag — usado para calcular
  // el rango [min(anchor, pointer)..max(anchor, pointer)] asi el usuario
  // puede arrastrar tanto a la derecha como a la izquierda sin confusiones.
  const [isDragging, setIsDragging] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<string | null>(null);

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
      setDragAnchor(null);
      setIsDragging(false);
      setBlockNote("");
    }
  }, [open, property?.id]);

  // Soltar el mouse en cualquier lado termina el drag. Pongo listener
  // global porque el usuario puede soltar fuera del modal (ej. sobre el
  // side panel o scrollbar).
  useEffect(() => {
    if (!isDragging) return;
    const onUp = () => setIsDragging(false);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging]);

  // Al abrir, scrollear a la celda de HOY centrada en el viewport.
  // Uso timeout minimo porque el Dialog tarda 1 frame en pintar el contenido.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = todayCellRef.current;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }, 80);
    return () => clearTimeout(t);
  }, [open, property?.id]);

  // IntersectionObserver para saber que mes esta visible y actualizar
  // el titulo del header. Observa cada bloque de mes y elige el que mas
  // intersecta con el viewport.
  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Tomamos el que mas visible este.
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const key = (best.target as HTMLElement).dataset.monthKey;
        if (!key) return;
        const [y, m] = key.split("-").map(Number);
        setVisibleMonth(new Date(y, m - 1, 1));
      },
      { root, threshold: [0.2, 0.5, 0.8] },
    );
    monthRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [open, months]);

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

  const bookings = property?.bookings ?? [];
  const selectedBooking = selectedBookingId
    ? bookings.find((b) => String(b.id) === selectedBookingId) ?? null
    : null;
  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const scrollToMonth = (d: Date) => {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const el = monthRefs.current.get(key);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const goPrevMonth = () => scrollToMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1));
  const goNextMonth = () => scrollToMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
  const goToday = () => {
    const el = todayCellRef.current;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // mousedown: inicia drag O segundo click del click-click (si ya hay start).
  const handleDayMouseDown = useCallback(
    (dayStr: string, bookingsOnDay: Booking[]) => {
      const firstBooking = bookingsOnDay[0];
      if (firstBooking) {
        setSelectedBookingId(String(firstBooking.id));
        setSelectedTaskId(null);
        setRangeStart(null);
        setRangeEnd(null);
        return;
      }
      setSelectedBookingId(null);
      setSelectedTaskId(null);
      // Si ya hay un start seleccionado (pero sin end), este click es el
      // segundo click-click → lo usamos como end del rango actual.
      if (rangeStart && !rangeEnd) {
        if (dayStr < rangeStart) {
          setRangeEnd(rangeStart);
          setRangeStart(dayStr);
        } else {
          setRangeEnd(dayStr);
        }
        return;
      }
      // Nuevo rango: seteamos start y activamos drag. Si el usuario suelta
      // sin moverse, queda en modo "click-click" esperando el segundo click.
      setRangeStart(dayStr);
      setRangeEnd(null);
      setDragAnchor(dayStr);
      setIsDragging(true);
    },
    [rangeStart, rangeEnd],
  );

  // mouseenter: si estoy draggeando, recalcula rango desde el anchor.
  const handleDayMouseEnter = useCallback(
    (dayStr: string) => {
      if (!isDragging || !dragAnchor) return;
      const lo = dayStr < dragAnchor ? dayStr : dragAnchor;
      const hi = dayStr < dragAnchor ? dragAnchor : dayStr;
      setRangeStart(lo);
      setRangeEnd(hi);
    },
    [isDragging, dragAnchor],
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
        setDragAnchor(null);
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

  // Stats del mes visible (para el panel cuando no hay seleccion).
  const monthStats = useMemo(() => {
    const monthStartStr = toLocalDateStr(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1));
    const monthEndStr = toLocalDateStr(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
    let reservas = 0;
    let bloqueos = 0;
    let nightsBooked = 0;
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    for (const b of bookings) {
      if (b.end <= monthStartStr || b.start >= monthEndStr) continue;
      if (b.status === "cancelled") continue;
      if (isBlockBooking(b)) bloqueos++;
      else reservas++;
      const ovStart = b.start > monthStartStr ? b.start : monthStartStr;
      const ovEnd = b.end < monthEndStr ? b.end : monthEndStr;
      const ov = Math.round(
        (parseLocalDate(ovEnd).getTime() - parseLocalDate(ovStart).getTime()) / 86400000,
      );
      if (ov > 0) nightsBooked += ov;
    }
    const occupancy = Math.round((nightsBooked / daysInMonth) * 100);
    const tasksMonth = tasks.filter(
      (t) => t.dueDate >= monthStartStr && t.dueDate < monthEndStr,
    ).length;
    return { reservas, bloqueos, nightsBooked, daysInMonth, occupancy, tasks: tasksMonth };
  }, [bookings, tasks, visibleMonth]);

  if (!property) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(1400px,95vw)] w-[95vw] h-[92vh] p-0 rounded-2xl overflow-hidden flex flex-col bg-card [&>button.absolute]:hidden"
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
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={goPrevMonth} aria-label="Mes anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[180px] text-center">
              <p className="font-black capitalize">{monthLabel(visibleMonth)}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={goNextMonth} aria-label="Mes siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 ml-2 rounded-xl" onClick={goToday}>
              Hoy
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 ml-2"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Scroll container con todos los meses apilados */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Weekday header — sticky arriba del scroll */}
            <div className="grid grid-cols-7 border-b bg-muted/30">
              {weekdays.map((w) => (
                <div key={w} className="h-9 flex items-center justify-center text-[10px] uppercase tracking-widest font-black text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>

            {/* Meses apilados verticalmente, scroll libre */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {months.map((m) => {
                const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
                return (
                  <MonthBlock
                    key={key}
                    monthDate={m}
                    setRef={(el) => {
                      if (el) monthRefs.current.set(key, el);
                      else monthRefs.current.delete(key);
                    }}
                    setTodayRef={(el) => { todayCellRef.current = el; }}
                    bookings={bookings}
                    tasks={tasks}
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    selectedBookingId={selectedBookingId}
                    selectedTaskId={selectedTaskId}
                    checkOutTime={property?.checkOutTime ?? "12:00"}
                    checkInTime={property?.checkInTime ?? "14:00"}
                    onDayMouseDown={handleDayMouseDown}
                    onDayMouseEnter={handleDayMouseEnter}
                    onBookingClick={(b) => {
                      setSelectedBookingId(String(b.id));
                      setSelectedTaskId(null);
                      setRangeStart(null);
                      setRangeEnd(null);
                    }}
                    onTaskClick={(t) => {
                      setSelectedTaskId(t.id);
                      setSelectedBookingId(null);
                      setRangeStart(null);
                      setRangeEnd(null);
                    }}
                  />
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
                  setDragAnchor(null);
                  setBlockNote("");
                }}
              />
            ) : (
              <MonthSummaryPanel
                stats={monthStats}
                monthText={monthLabel(visibleMonth)}
              />
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── sub-panels ─────────────

// MonthBlock — renderiza un mes con su titulo y grid de dias. Usa
// gridColumnStart para posicionar el dia 1 en la columna correcta
// (Lun-Dom) sin duplicar celdas de meses adyacentes como hacia el grid
// anterior. Titulo sticky al top del mes para que el usuario sepa en
// que mes esta aunque scrollee rapido.
type MonthBlockProps = {
  monthDate: Date;
  setRef: (el: HTMLElement | null) => void;
  setTodayRef: (el: HTMLDivElement | null) => void;
  bookings: Booking[];
  tasks: CleaningTask[];
  rangeStart: string | null;
  rangeEnd: string | null;
  selectedBookingId: string | null;
  selectedTaskId: string | null;
  checkOutTime: string;
  checkInTime: string;
  onDayMouseDown: (dayStr: string, bookingsOnDay: Booking[]) => void;
  onDayMouseEnter: (dayStr: string) => void;
  onBookingClick: (b: Booking) => void;
  onTaskClick: (t: CleaningTask) => void;
};

function MonthBlock({
  monthDate,
  setRef,
  setTodayRef,
  bookings,
  tasks,
  rangeStart,
  rangeEnd,
  selectedBookingId,
  selectedTaskId,
  checkOutTime,
  checkInTime,
  onDayMouseDown,
  onDayMouseEnter,
  onBookingClick,
  onTaskClick,
}: MonthBlockProps) {
  const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  const today = todayStr();

  // Dias solo del mes (no incluyo adyacentes — uso grid-column-start
  // para posicionar el primer dia en la columna correcta).
  const days = useMemo(() => {
    const totalDays = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const out: { date: Date; str: string; isToday: boolean }[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
      const str = toLocalDateStr(date);
      out.push({ date, str, isToday: str === today });
    }
    return out;
  }, [monthDate, today]);

  // getDay: 0=Dom, 1=Lun ... 6=Sab. Para Lun como inicio, offset = dow-1 (Dom → 6).
  const firstDow = days[0].date.getDay();
  const startCol = firstDow === 0 ? 7 : firstDow; // 1..7 (Lun=1, Dom=7)

  return (
    <section
      ref={setRef as (el: HTMLElement | null) => void}
      data-month-key={monthKey}
      className="border-b"
    >
      <h3 className="sticky top-0 bg-card/95 backdrop-blur px-4 py-2.5 z-10 text-sm font-black capitalize border-b">
        {monthLabel(monthDate)}
      </h3>
      <div className="grid grid-cols-7 divide-x divide-y divide-border/40">
        {days.map((d, idx) => {
          const onDay = bookings.filter(
            (b) => b.status !== "cancelled" && bookingOnDay(b, d.str),
          );
          // Reservas (no bloqueos) cuyo check-out es ESTE dia. Bookingonday
          // las excluye porque check_out es exclusive — pero visualmente la
          // manana sigue ocupada hasta la hora del checkout. Mostramos una
          // mini-pill desaturada para comunicarlo. Excluye bloqueos: para
          // un bloqueo no aplica el concepto de "salida del huesped".
          const departing = bookings.filter(
            (b) =>
              b.status !== "cancelled" &&
              !isBlockBooking(b) &&
              b.end === d.str,
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
              ref={d.isToday ? setTodayRef : undefined}
              onMouseDown={(e) => {
                // Click izquierdo solamente (0). Derecho o rueda: ignorar.
                if (e.button !== 0) return;
                e.preventDefault(); // evita seleccion de texto al drag
                onDayMouseDown(d.str, onDay);
              }}
              onMouseEnter={() => onDayMouseEnter(d.str)}
              style={idx === 0 ? { gridColumnStart: startCol } : undefined}
              className={cn(
                "min-h-[90px] p-1.5 flex flex-col gap-1 cursor-pointer transition-colors relative group hover:bg-primary/[0.04] select-none",
                isInRange && "bg-primary/10 ring-1 ring-inset ring-primary/40",
                (isRangeStart || isRangeEnd) && "bg-primary/20",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[11px] font-black w-6 h-6 flex items-center justify-center rounded-full",
                    d.isToday && "bg-rose-600 text-white",
                    !d.isToday && "text-foreground/80",
                  )}
                >
                  {d.date.getDate()}
                </span>
                {departing.length + onDay.length + tasksDay.length > 3 && (
                  <span className="text-[9px] text-muted-foreground font-bold">
                    +{departing.length + onDay.length + tasksDay.length - 3}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {departing.slice(0, 1).map((b) => (
                  <div
                    key={`out-${b.id}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBookingClick(b);
                    }}
                    title={`Salida ${checkOutTime} · ${b.guest}`}
                    className={cn(
                      "h-4 px-1.5 rounded text-[9px] font-bold truncate flex items-center gap-1 border",
                      checkoutPillClass(b),
                      selectedBookingId === String(b.id) && "ring-2 ring-foreground/80",
                    )}
                  >
                    <LogOut className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">Sale {checkOutTime} · {b.guest}</span>
                  </div>
                ))}
                {onDay.slice(0, Math.max(1, 3 - departing.length)).map((b) => {
                  const isCheckIn = b.start === d.str;
                  const isBackToBack = isCheckIn && departing.length > 0;
                  return (
                  <div
                    key={b.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBookingClick(b);
                    }}
                    title={isCheckIn ? `Entrada ${checkInTime} · ${b.guest}` : pillLabel(b)}
                    className={cn(
                      "h-5 px-1.5 rounded text-[10px] font-bold truncate flex items-center gap-1 shadow-sm",
                      pillClass(b),
                      selectedBookingId === String(b.id) && "ring-2 ring-foreground/80",
                    )}
                  >
                    {isBlockBooking(b) && <Lock className="h-2.5 w-2.5 shrink-0" />}
                    {isBackToBack && <LogIn className="h-2.5 w-2.5 shrink-0" />}
                    <span className="truncate">
                      {isBackToBack ? `Entra ${checkInTime} · ${b.guest}` : pillLabel(b)}
                    </span>
                  </div>
                  );
                })}
                {tasksDay.slice(0, Math.max(0, 3 - departing.length - onDay.length)).map((t) => (
                  <div
                    key={t.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(t);
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
    </section>
  );
}

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

      <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-[11px] text-muted-foreground leading-relaxed">
        Para gestionar el checklist, asignar o validar fotos, entra al modulo
        <strong> Limpiezas</strong>. Aca se muestra solo el resumen.
      </div>
    </div>
  );
}
