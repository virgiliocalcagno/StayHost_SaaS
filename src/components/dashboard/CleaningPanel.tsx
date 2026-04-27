"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Clock,
  MapPin,
  User,
  CheckCircle2,
  AlertCircle,
  Calendar,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  LogOut,
  Users,
  Sparkles,
  Camera,
  Archive,
  Eye,
  Box,
  Check,
  X,
  ArrowLeft,
  Tv,
  Wind,
  Refrigerator,
  PackageCheck,
  Upload,
  Image as ImageIcon,
  Bot,
  Wrench,
  Zap,
  Bed,
  Layers,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getTeam, getProperties, type RawTeamMember } from "@/services/apiServices";

// Nuevos componentes universales de Staff
import { StaffWizard } from "@/components/staff-ui/StaffWizard";
import { StaffTaskDetail } from "@/components/staff-ui/StaffTaskDetail";
import { CleaningTaskDetailModal } from "@/components/dashboard/CleaningTaskDetailModal";
import { getEffectiveStatus, deriveCorrectStatus } from "@/lib/cleaning/status";
import type { MaintenanceTicket } from "@/types/maintenance";
import { MAINTENANCE_SEVERITY_LABELS, MAINTENANCE_CATEGORY_LABELS } from "@/types/maintenance";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface CleaningTask {
  id: string;
  propertyId: string;
  propertyName: string;
  address: string;
  propertyImage?: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  dueDate: string; // ISO Date String
  dueTime: string;
  status: "pending" | "in_progress" | "completed" | "issue" | "unassigned" | "assigned" | "accepted" | "rejected";
  priority: "low" | "medium" | "high" | "critical";
  isBackToBack: boolean;
  isVacant?: boolean;          // Sin check-in ese día → baja urgencia
  guestCount?: number;         // Número de huéspedes salientes
  guestName: string;
  checklist: { id: number; task: string; done: boolean }[];
  incidentReport?: string;
  rejectionReason?: string;    // Motivo indicado por el staff al rechazar
  declinedByIds?: string[];
  standardInstructions?: string; // Instrucciones base importadas de la propiedad
  // Advanced fields
  arrivalDate?: string;
  stayDuration?: number;
  acceptanceStatus?: "pending" | "accepted" | "declined";
  startTime?: string; // Hora en que inició la limpieza
  arrivingGuestName?: string;  // Huésped que entra hoy
  arrivingGuestCount?: number; // Pax que entra hoy
  isWaitingValidation?: boolean;
  closurePhotos?: { category: string; url: string }[];
  reportedIssues?: string[];
  suppliesReport?: { item: string; needed: number; status: "ok" | "missing" | "replenished" }[];
  checklistItems?: { id: string; label: string; done: boolean; type: "general" | "appliance" }[];
  // Datos de la reserva asociada (para el header de la tarjeta)
  bookingId?: string;
  bookingChannel?: string;       // "airbnb" | "vrbo" | "booking" | "manual" | "block"
  bookingChannelCode?: string;   // ej. HMNFA2954Y, codigo del canal
  bookingCheckIn?: string;       // ISO date — entrada del huesped saliente
  bookingCheckOut?: string;      // ISO date — checkout (== dueDate)
  guestPhone?: string;
  createdAt?: string;            // ISO timestamp — creacion de la tarea (audit log)
  updatedAt?: string;            // ISO timestamp — ultima modificacion (audit log)
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  tasksToday: number;
  completedTasks: number;
  phone: string;
  available?: boolean;
}

// ─── Mock Data Helpers ──────────────────────────────────────────────────────

// Returns YYYY-MM-DD in the USER's local timezone, not UTC.
// Using toISOString() was the old bug: after ~8pm in Chile (UTC-4) the UTC
// date rolls forward one day, so "today" was being labeled as tomorrow.
const getDateStr = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toLocalDateStr(d);
};

// Same helper for an arbitrary Date — returns its local YYYY-MM-DD.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const MOCK_TEAM: TeamMember[] = [
  { id: "1", name: "Laura Sánchez", role: "Limpieza", avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&h=100&fit=crop", tasksToday: 3, completedTasks: 145, phone: "+5212345678" },
  { id: "2", name: "Miguel Torres", role: "Mantenimiento", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop", tasksToday: 2, completedTasks: 89, phone: "+5212345679" },
  { id: "3", name: "Carmen Ruiz", role: "Limpieza", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop", tasksToday: 4, completedTasks: 210, phone: "+5212345680" },
];


export default function CleaningPanel() {
  const [view, setView] = useState<"day" | "week" | "month" | "validate" | "unassigned">("day");
  const [activeMonth, setActiveMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [tasks, setTasks] = useState<CleaningTask[]>([]);

  const loadTasks = () => {
    // Tenant is resolved server-side from the session cookie.
    fetch("/api/cleaning-tasks", { credentials: "same-origin" })
      .then(r => r.json())
      .then(data => {
        if (!data.tasks?.length) return;
        const incoming = data.tasks as CleaningTask[];

        // Auto-heal bidireccional: deriveCorrectStatus devuelve el status
        // que la fila deberia tener segun su data real (assigneeId), o null
        // si esta coherente. Cubre los dos sentidos:
        //   - status="assigned" sin assigneeId → "unassigned"
        //   - status="unassigned" con assigneeId → "assigned"
        // "rejected" se EXCLUYE a proposito: un rechazo huerfano es estado
        // valido (esperando reasignacion) y borrarlo perderia el motivo.
        const corrections = new Map<string, string>();
        for (const t of incoming) {
          const correct = deriveCorrectStatus(t);
          if (correct && correct !== t.status) {
            corrections.set(t.id, correct);
          }
        }
        if (corrections.size > 0) {
          // Telemetria: si esto se dispara seguido, hay un flujo upstream
          // que esta sembrando datos rotos. Loguear permite detectarlo
          // antes de que el auto-heal lo enmascare en silencio.
          console.warn(
            "[cleaning] auto-heal: status incoherente con assigneeId",
            Object.fromEntries(corrections),
          );
        }

        const healed = incoming.map((t) => {
          const fix = corrections.get(t.id);
          return fix ? { ...t, status: fix as CleaningTask["status"] } : t;
        });
        setTasks(healed);

        for (const [id, status] of corrections) {
          patchTask(id, { status });
        }
      })
      .catch(() => {});
  };

  useEffect(() => { loadTasks(); }, []);

  // Incidencias activas: tickets de mantenimiento abiertos asociados a
  // propiedades del tenant. La sidebar del modulo los muestra como signal
  // de "que esta roto ahora mismo" — datos reales, sin mock.
  const [incidents, setIncidents] = useState<MaintenanceTicket[]>([]);
  useEffect(() => {
    fetch(
      "/api/maintenance-tickets?status=open,awaiting_response,confirmed,in_progress,pending_verification",
      { credentials: "same-origin" },
    )
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.tickets)) setIncidents(data.tickets);
      })
      .catch(() => {});
  }, []);

  const patchTask = (id: string, changes: Record<string, unknown>) => {
    fetch(`/api/cleaning-tasks?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }).catch(() => {});
  };

  const [selectedStaff, setSelectedStaff] = useState<string>("all");
  const [activeDate, setActiveDate] = useState<string>(getDateStr(0));
  const [team, setTeam] = useState<TeamMember[]>(MOCK_TEAM);
  const [rawTeam, setRawTeam] = useState<RawTeamMember[]>([]);

  // Properties (for auto-assign config + bed/instructions)
  const [properties, setProperties] = useState<{
    id: string;
    name: string;
    address?: string;
    addressUnit?: string;
    neighborhood?: string;
    city?: string;
    image?: string;
    autoAssignCleaner?: boolean;
    cleanerPriorities?: string[];
    bedConfiguration?: string;
    standardInstructions?: string;
    evidenceCriteria?: string[];
    accessMethod?: "ttlock" | "keybox" | "in_person" | "doorman";
    keyboxCode?: string;
    keyboxLocation?: string;
    keyboxPhotoUrl?: string;
  }[]>([]);

  // Nueva Orden modal state
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({
    propertyId: "",
    dueDate: getDateStr(0),
    dueTime: "11:00",
    guestName: "",
    guestCount: "" as string,
    priority: "medium" as CleaningTask["priority"],
    isBackToBack: false,
    isVacant: false,
  });

  // Experience State
  const [viewMode, setViewMode] = useState<"admin" | "staff">("admin");
  const [staffAppScreen, setStaffAppScreen] = useState<"home" | "task">("home");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [staffTimeFilter, setStaffTimeFilter] = useState<"today" | "tomorrow" | "week">("today");
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [tempPhotos, setTempPhotos] = useState<{ category: string; url: string }[]>([]);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  
  const searchParams = useSearchParams();

  // URL Auto-navigation for Staff
  useEffect(() => {
    const viewParam = searchParams.get("view");
    const taskParam = searchParams.get("task");
    
    if (viewParam === "staff") {
      setViewMode("staff");
      if (taskParam) {
        setActiveTaskId(taskParam);
        setStaffAppScreen("task");
        setWizardStep(1); 
      } else {
        setStaffAppScreen("home");
      }
    }
  }, [searchParams]);

  // Sync team & properties via apiServices
  useEffect(() => {
    getTeam()
      .then(rawData => {
        if (!rawData.length) return;
        setRawTeam(rawData);
        setTeam(rawData.map((m: RawTeamMember) => ({
          id: m.id,
          name: m.name,
          role: m.role === "cleaner" ? "Limpieza" : m.role === "maintenance" ? "Mantenimiento" : "Staff",
          avatar: m.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}`,
          tasksToday: m.tasksToday || 0,
          completedTasks: m.tasksCompleted || 0,
          phone: m.phone.replace(/\D/g, ""),
          available: m.available ?? true,
        })));
      })
      .catch(e => console.error("Error loading team", e));

    getProperties().then(setProperties).catch(() => {});
  }, []);

  // Rango de fechas que cubre la vista activa. Los KPIs y los costos
  // estimados se calculan sobre este rango — antes siempre usaban "hoy"
  // aunque el usuario estuviera viendo Semanal o Mensual, lo que daba
  // numeros que no encajaban con la lista de abajo.
  const period = useMemo(() => {
    if (view === "day") {
      const today = getDateStr(0);
      return { start: today, end: today, label: "Hoy", short: "hoy" };
    }
    if (view === "week") {
      return {
        start: getDateStr(0),
        end: getDateStr(6),
        label: "Esta semana",
        short: "semana",
      };
    }
    if (view === "validate") {
      // A validar: rango abierto (no acotado a un periodo). Mostramos
      // todas las tareas que el staff envio, sin importar la fecha.
      return {
        start: "0000-00-00",
        end: "9999-12-31",
        label: "A validar",
        short: "a validar",
      };
    }
    if (view === "unassigned") {
      // Urgentes sin asignar: rango abierto, el filtro real es por
      // proximidad temporal (proximas 24h). Lo que importa es que el
      // owner las vea juntas y las pueda asignar de un saque.
      return {
        start: "0000-00-00",
        end: "9999-12-31",
        label: "Sin asignar urgente",
        short: "sin asignar",
      };
    }
    const [y, m] = activeMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthName = new Date(y, m - 1, 1)
      .toLocaleDateString("es-ES", { month: "long" })
      .replace(/^./, (c) => c.toUpperCase());
    return {
      start: `${activeMonth}-01`,
      end: `${activeMonth}-${String(lastDay).padStart(2, "0")}`,
      label: monthName,
      short: monthName,
    };
  }, [view, activeMonth]);

  const stats = useMemo(() => {
    const inPeriod = tasks.filter(
      (t) => t.dueDate >= period.start && t.dueDate <= period.end,
    );
    // Esperando validacion del owner: el staff envio el reporte (fotos +
    // checklist) y la tarea esta en cola para que el owner la apruebe o
    // pida refoto. Se cuenta sobre TODAS las tareas, no solo el periodo,
    // porque son urgentes sin importar la fecha del checkout.
    const awaitingValidation = tasks.filter((t) => t.isWaitingValidation === true).length;

    // Tareas sin asignar con checkout en menos de 24h o ya pasado: riesgo
    // real de que la propiedad no se limpie a tiempo. Se cuenta sobre
    // TODAS las tareas (no solo el periodo de vista) porque cualquier
    // urgente debe gritar igual aunque el owner este viendo otra semana.
    const now = Date.now();
    const unassignedUrgent = tasks.filter((t) => {
      if (t.assigneeId) return false;
      if (getEffectiveStatus(t) === "completed") return false;
      const [hStr, mStr] = (t.dueTime || "11:00").split(":");
      const [yr, mo, dy] = t.dueDate.split("-").map(Number);
      const checkout = new Date(
        yr,
        (mo || 1) - 1,
        dy || 1,
        parseInt(hStr, 10) || 11,
        parseInt(mStr, 10) || 0,
      );
      const hours = (checkout.getTime() - now) / (1000 * 60 * 60);
      return hours < 24; // incluye atrasadas (hours < 0)
    }).length;

    return {
      total: inPeriod.length,
      // KPIs usan effective status para que filas con datos inconsistentes
      // (status="completed" sin que la limpieza realmente termino, etc.)
      // no inflen los contadores. getEffectiveStatus deja completed/issue
      // intactos pero corrige los pares assigneeId<->status incoherentes.
      completed: inPeriod.filter((t) => getEffectiveStatus(t) === "completed").length,
      pending: inPeriod.filter((t) => getEffectiveStatus(t) !== "completed").length,
      critical: inPeriod.filter((t) => t.priority === "critical").length,
      awaitingValidation,
      unassignedUrgent,
    };
  }, [tasks, period]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Vista diaria: solo hoy.
    // Vista semanal: dia seleccionado en el strip de tabs.
    // Vista mensual: dia seleccionado en el grid de calendario (activeDate).
    // Vista validate: solo tareas que el staff envio y esperan aprobacion
    //   del owner. Sin filtro de fecha — son urgentes igual.
    // Filtro de rango segun vista. Antes week/month filtraban a un solo
    // dia (activeDate), lo que dejaba el calendario como decoracion: el
    // owner perdia visibilidad de la semana/mes y tenia que clickear dia
    // por dia. Ahora cada vista muestra TODO su periodo y el strip /
    // calendario quedan como ancla visual.
    if (view === "validate") {
      result = result.filter(t => t.isWaitingValidation === true);
    } else if (view === "unassigned") {
      // Mismo criterio que stats.unassignedUrgent: sin asignar y con
      // checkout en las proximas 24h (incluye atrasadas).
      const now = Date.now();
      result = result.filter(t => {
        if (t.assigneeId) return false;
        if (getEffectiveStatus(t) === "completed") return false;
        const [hStr, mStr] = (t.dueTime || "11:00").split(":");
        const [yr, mo, dy] = t.dueDate.split("-").map(Number);
        const checkout = new Date(
          yr,
          (mo || 1) - 1,
          dy || 1,
          parseInt(hStr, 10) || 11,
          parseInt(mStr, 10) || 0,
        );
        return (checkout.getTime() - now) / (1000 * 60 * 60) < 24;
      });
    } else if (view === "day") {
      result = result.filter(t => t.dueDate === getDateStr(0));
    } else if (view === "week" || view === "month") {
      result = result.filter(t => t.dueDate >= period.start && t.dueDate <= period.end);
    }

    if (selectedStaff !== "all") {
      result = result.filter(t => t.assigneeId === selectedStaff);
    }

    // Prioridad ordinal — sirve para ordenar dentro de cada dia.
    const priorityRank: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3,
    };

    return result.sort((a, b) => {
      // En vista validate: por checkout mas viejo primero (la mas urgente
      // de aprobar es la que lleva mas tiempo esperando).
      if (view === "validate") {
        return a.dueDate.localeCompare(b.dueDate);
      }
      // En vista unassigned: la mas cercana al checkout primero (mas
      // urgente de asignar). Mismo criterio temporal que el helper.
      if (view === "unassigned") {
        return a.dueDate.localeCompare(b.dueDate) || (a.dueTime || "").localeCompare(b.dueTime || "");
      }
      // En week/month: primero por fecha asc (orden cronologico para que
      // los headers de dia salgan en orden), despues por prioridad desc
      // dentro del mismo dia.
      if (view === "week" || view === "month") {
        const dateCmp = a.dueDate.localeCompare(b.dueDate);
        if (dateCmp !== 0) return dateCmp;
        if (a.isVacant !== b.isVacant) return a.isVacant ? 1 : -1;
        return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
      }
      // Vista diaria: vacantes al final, criticos al frente.
      if (a.isVacant && !b.isVacant) return 1;
      if (!a.isVacant && b.isVacant) return -1;
      return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
    });
  }, [tasks, view, selectedStaff, period]);

  const getStatusBadge = (task: CleaningTask) => {
    const effective = getEffectiveStatus(task);
    if (effective === "completed") {
      return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white border-0">Completada</Badge>;
    }
    if (effective === "in_progress") {
      return (
        <div className="flex flex-col items-end gap-1">
          <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground border-0 italic animate-pulse">En curso</Badge>
          {task.startTime && <span className="text-[10px] font-bold text-primary">Inició {task.startTime}</span>}
        </div>
      );
    }
    if (effective === "issue") {
      return <Badge variant="destructive">Incidencia</Badge>;
    }
    if (effective === "unassigned") {
      return <Badge className="bg-amber-100 text-amber-700 border-amber-300 animate-pulse">Sin asignar</Badge>;
    }
    if (effective === "assigned") {
      return <Badge className="bg-blue-50 text-blue-700 border-blue-200">Asignada</Badge>;
    }
    if (effective === "accepted") {
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Aceptada ✓</Badge>;
    }
    if (task.status === "rejected") {
      return (
        <div className="flex flex-col items-end gap-1">
          <Badge className="bg-rose-100 text-rose-700 border-rose-300">Rechazada</Badge>
          {task.rejectionReason && (
            <span className="text-[10px] text-rose-500 max-w-[140px] text-right leading-tight">"{task.rejectionReason}"</span>
          )}
        </div>
      );
    }
    // Fallback: legacy pending — check acceptanceStatus
    if (task.acceptanceStatus === "accepted") {
      return <Badge variant="outline" className="border-emerald-200 text-emerald-600 bg-emerald-50">Aceptada</Badge>;
    }
    if (task.acceptanceStatus === "declined") {
      return <Badge variant="outline" className="border-rose-200 text-rose-600 bg-rose-50">Rechazada</Badge>;
    }
    return <Badge variant="secondary" className="bg-muted text-muted-foreground border-0">Pendiente</Badge>;
  };

  // Urgencia de una tarea sin asignar — escala segun horas al checkout.
  // Permite que la UI grite mas fuerte cuando se acerca la hora sin que
  // nadie haya tomado la tarea (riesgo real de que la propiedad quede sin
  // limpiar para el siguiente huesped).
  type UnassignedLevel = "none" | "scheduled" | "soon" | "urgent" | "critical" | "overdue";
  const getUnassignedUrgency = (task: CleaningTask): {
    level: UnassignedLevel;
    label: string;
    classes: string;
    pulse: boolean;
    hours: number;
  } => {
    if (task.assigneeId) {
      return { level: "none", label: "", classes: "", pulse: false, hours: 0 };
    }
    // Calculo cross-timezone: armamos la fecha local (no UTC) sumando la
    // hora del checkout. Si dueTime no esta seteado, asumimos 11am (default
    // del sistema).
    const [hStr, mStr] = (task.dueTime || "11:00").split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const [yr, mo, dy] = task.dueDate.split("-").map(Number);
    const checkout = new Date(yr, (mo || 1) - 1, dy || 1, isNaN(h) ? 11 : h, isNaN(m) ? 0 : m);
    const hours = (checkout.getTime() - Date.now()) / (1000 * 60 * 60);

    if (hours < 0) {
      return {
        level: "overdue",
        label: `ATRASADA · ${formatTime12(task.dueTime)}`,
        classes: "bg-rose-600 text-white border-rose-700",
        pulse: true,
        hours,
      };
    }
    if (hours < 6) {
      return {
        level: "critical",
        label: `URGENTE · checkout HOY ${formatTime12(task.dueTime)}`,
        classes: "bg-rose-500 text-white border-rose-600",
        pulse: true,
        hours,
      };
    }
    if (hours < 24) {
      const h_int = Math.floor(hours);
      return {
        level: "urgent",
        label: `Sin asignar · checkout en ${h_int}h`,
        classes: "bg-rose-100 text-rose-700 border-rose-200",
        pulse: true,
        hours,
      };
    }
    if (hours < 48) {
      return {
        level: "soon",
        label: "Sin asignar · mañana",
        classes: "bg-amber-100 text-amber-700 border-amber-300",
        pulse: false,
        hours,
      };
    }
    const days = Math.floor(hours / 24);
    return {
      level: "scheduled",
      label: `Sin asignar · ${days} día${days === 1 ? "" : "s"}`,
      classes: "bg-slate-100 text-slate-600 border-slate-200",
      pulse: false,
      hours,
    };
  };

  // Helpers de presentacion para el header de la tarjeta de tarea ─────────
  const CHANNEL_INFO: Record<string, { label: string; color: string }> = {
    airbnb: { label: "Airbnb", color: "bg-rose-500" },
    vrbo: { label: "VRBO", color: "bg-blue-500" },
    booking: { label: "Booking.com", color: "bg-blue-700" },
    manual: { label: "Reserva directa", color: "bg-emerald-600" },
    direct: { label: "Reserva directa", color: "bg-emerald-600" },
    block: { label: "Bloqueo", color: "bg-slate-500" },
  };

  const getChannelBadge = (task: CleaningTask) => {
    const key = (task.bookingChannel ?? "manual").toLowerCase();
    return CHANNEL_INFO[key] ?? { label: key, color: "bg-slate-500" };
  };

  const getReservationCode = (task: CleaningTask) => {
    if (task.bookingChannelCode) return task.bookingChannelCode.toUpperCase();
    if (task.bookingId) return `SH${task.bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    return "MANUAL";
  };

  const formatLongDate = (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso + (iso.includes("T") ? "" : "T00:00:00"));
    return d.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  };

  const formatTime12 = (time: string) => {
    if (!time) return "";
    const [h, m] = time.split(":").map(Number);
    if (Number.isNaN(h)) return time;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
  };

  const computeNights = (checkIn?: string, checkOut?: string) => {
    if (!checkIn || !checkOut) return null;
    const a = new Date(checkIn + (checkIn.includes("T") ? "" : "T00:00:00")).getTime();
    const b = new Date(checkOut + (checkOut.includes("T") ? "" : "T00:00:00")).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)));
  };

  const getPriorityInfo = (task: CleaningTask) => {
    const isToday = task.dueDate === getDateStr(0);
    const isTomorrow = task.dueDate === getDateStr(1);
    const [hoursStr] = task.dueTime.split(":");
    const hours = parseInt(hoursStr);
    
    // Nivel 1: URGENTE (Rojo Parpadeante) - Hoy + Salida < 6h o Crítico
    const isEmergency = (isToday && hours < 6) || task.priority === "critical";
    
    if (isEmergency) {
      return { 
        label: "¡URGENTE!", 
        color: "text-white bg-rose-600 border-none animate-pulse", 
        icon: AlertTriangle,
        isUrgent: true,
        bgUrgent: "bg-rose-50 ring-2 ring-rose-500",
        shadow: "shadow-lg shadow-rose-200"
      };
    }
    
    // Nivel 2: ALTA (Rojo Sólido) - Salida Hoy
    if (isToday) {
      return { 
        label: "PRIORIDAD ALTA", 
        color: "text-rose-600 bg-rose-50 border-rose-200", 
        icon: AlertCircle, 
        isUrgent: false,
        bgUrgent: "bg-white border-rose-100",
        shadow: "shadow-sm"
      };
    }

    // Nivel 3: MEDIA (Amarillo) - Mañana
    if (isTomorrow) {
      return { 
        label: "PRIORIDAD MEDIA", 
        color: "text-amber-600 bg-amber-50 border-amber-200", 
        icon: Clock, 
        isUrgent: false,
        bgUrgent: "bg-white",
        shadow: "shadow-sm"
      };
    }

    // Nivel 4: BAJA (Verde) - Futura
    return { 
      label: "BAJA", 
      color: "text-emerald-600 bg-emerald-50 border-emerald-200", 
      icon: CheckCircle2, 
      isUrgent: false,
      bgUrgent: "bg-white",
      shadow: "shadow-sm"
    };
  };

  const dayTabs = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      // Use local date components, not UTC — fixes "Hoy" showing as tomorrow
      // after ~8pm in timezones west of UTC.
      const localDate = toLocalDateStr(d);
      days.push({
        label: i === 0 ? "Hoy" : i === 1 ? "Mañana" : d.toLocaleDateString('es-ES', { weekday: 'short' }),
        date: localDate,
        count: tasks.filter(t => t.dueDate === localDate).length
      });
    }
    return days;
  }, [tasks]);

  // Grid mensual: cada celda representa un dia del mes activo, con
  // contador de tareas pendientes (no completadas) para que el host
  // detecte "dias calientes" de un vistazo. Las completadas no son
  // accionables — incluirlas ensucia la senal visual.
  const monthGrid = useMemo(() => {
    const [y, m] = activeMonth.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0).getDate();
    // getDay(): 0=Dom, 1=Lun... Convertimos a semana lun=0..dom=6.
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const cells: Array<{ date: string | null; day: number | null; pending: number; total: number; isToday: boolean }> = [];
    const todayStr = getDateStr(0);
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ date: null, day: null, pending: 0, total: 0, isToday: false });
    }
    for (let day = 1; day <= lastDay; day++) {
      const date = `${activeMonth}-${String(day).padStart(2, "0")}`;
      const dayTasks = tasks.filter((t) => t.dueDate === date);
      cells.push({
        date,
        day,
        pending: dayTasks.filter((t) => getEffectiveStatus(t) !== "completed").length,
        total: dayTasks.length,
        isToday: date === todayStr,
      });
    }
    return cells;
  }, [activeMonth, tasks]);

  // "Hoy" para el calendario: vuelve al mes actual + selecciona el dia
  // de hoy. Necesario porque al navegar 6 meses adelante el host
  // perderia el ancla sin esto.
  const goToToday = () => {
    const today = getDateStr(0);
    const [y, m] = today.split("-");
    setActiveMonth(`${y}-${m}`);
    setActiveDate(today);
  };

  const monthLabel = useMemo(() => {
    const [y, m] = activeMonth.split("-").map(Number);
    return new Date(y, m - 1, 1)
      .toLocaleDateString("es-ES", { month: "long", year: "numeric" })
      .replace(/^./, (c) => c.toUpperCase());
  }, [activeMonth]);

  const shiftMonth = (delta: number) => {
    const [y, m] = activeMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setActiveMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleSendMessage = (phone: string, property: string, taskId: string) => {
    const link = `${window.location.origin}/dashboard?view=staff&task=${taskId}`;
    const msg = encodeURIComponent(`Hola, tienes una limpieza en ${property}. ✨\nAccede aquí para ver detalles y reportar: ${link}`);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  // ─── Auto-assign Logic ───────────────────────────────────────────────────
  const autoAssignFromProperty = useCallback((propertyId: string, skipIds: string[] = []): { id: string; name: string; avatar: string } | null => {
    const property = properties.find(p => p.id === propertyId);
    if (!property?.autoAssignCleaner || !property.cleanerPriorities?.length) return null;

    for (const cleanerId of property.cleanerPriorities) {
      if (skipIds.includes(cleanerId)) continue;
      const member = rawTeam.find(m => m.id === cleanerId);
      if (member?.available) {
        return {
          id: cleanerId,
          name: member.name,
          avatar: member.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}`,
        };
      }
    }
    return null;
  }, [properties, rawTeam]);

  const handleCreateTask = () => {
    if (!newTaskForm.propertyId) return;
    const property = properties.find(p => p.id === newTaskForm.propertyId);
    const assignee = autoAssignFromProperty(newTaskForm.propertyId);
    const derivedStatus: CleaningTask["status"] = assignee ? "assigned" : "unassigned";

    const newTask: CleaningTask = {
      id: `task-${Date.now()}`,
      propertyId: newTaskForm.propertyId,
      propertyName: property?.name || "Propiedad",
      address: property?.address || "",
      propertyImage: property?.image || "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=300&h=200&fit=crop",
      dueDate: newTaskForm.dueDate,
      dueTime: newTaskForm.dueTime,
      status: derivedStatus,
      priority: newTaskForm.priority,
      isBackToBack: newTaskForm.isBackToBack,
      isVacant: newTaskForm.isVacant,
      guestCount: newTaskForm.guestCount ? Number(newTaskForm.guestCount) : undefined,
      guestName: newTaskForm.guestName || "Nuevo huésped",
      acceptanceStatus: "pending",
      checklist: [],
      stayDuration: 2,
      standardInstructions: property?.standardInstructions || "",
      checklistItems: [
        { id: "c1", label: "Control Remoto TV", done: false, type: "appliance" },
        { id: "c2", label: "Control Abanico", done: false, type: "appliance" },
        { id: "c3", label: "Aire Acondicionado", done: false, type: "appliance" },
        { id: "c4", label: "Limpieza de pisos", done: false, type: "general" },
        { id: "c5", label: "Baño desinfectado", done: false, type: "general" },
      ],
      ...(assignee
        ? { assigneeId: assignee.id, assigneeName: assignee.name, assigneeAvatar: assignee.avatar }
        : {}),
    };

    setTasks(prev => [...prev, newTask]);
    setShowAddTask(false);
    setNewTaskForm({ propertyId: "", dueDate: getDateStr(0), dueTime: "11:00", guestName: "", priority: "medium", isBackToBack: false, isVacant: false, guestCount: "" });

    // Persist to Supabase. Tenant is resolved server-side from the session.
    fetch("/api/cleaning-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        propertyId: newTaskForm.propertyId,
        dueDate: newTaskForm.dueDate,
        dueTime: newTaskForm.dueTime,
        guestName: newTaskForm.guestName || "Nuevo huésped",
        priority: newTaskForm.priority,
        isBackToBack: newTaskForm.isBackToBack,
        isVacant: newTaskForm.isVacant,
        guestCount: newTaskForm.guestCount ? Number(newTaskForm.guestCount) : null,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.name ?? null,
        assigneeAvatar: assignee?.avatar ?? null,
      }),
    }).catch(() => {});
  };

  const currentActiveTask = tasks.find(t => t.id === activeTaskId);
  const currentProperty = currentActiveTask ? properties.find(p => p.id === currentActiveTask.propertyId) : null;
  const activeCriteria = currentProperty?.evidenceCriteria && currentProperty.evidenceCriteria.length > 0 
    ? currentProperty.evidenceCriteria 
    : ["Cocina", "Habitación", "Baño"];

  // ─── Staff Wizard Logic ───────────────────────────────────────────────────
  
  const handleNextStep = () => setWizardStep(prev => prev + 1);
  const handlePrevStep = () => setWizardStep(prev => prev - 1);

  const toggleChecklistItem = (taskId: string, itemId: string) => {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, checklistItems: t.checklistItems?.map(i => i.id === itemId ? { ...i, done: !i.done } : i) };
      });
      const updated = next.find(t => t.id === taskId);
      if (updated) patchTask(taskId, { checklistItems: updated.checklistItems });
      return next;
    });
  };

  const handleUploadPhoto = (category: string) => {
    // Simulación de carga y compresión
    const mockUrl = `https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=400&fit=crop&q=60`;
    setTempPhotos(prev => {
      const existing = prev.filter(p => p.category !== category);
      return [...existing, { category, url: mockUrl }];
    });
  };

  const handleSubmitTask = () => {
    if (!activeTaskId) return;
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, status: "completed", isWaitingValidation: true, closurePhotos: tempPhotos } : t
    ));
    patchTask(activeTaskId, { status: "completed", isWaitingValidation: true, closurePhotos: tempPhotos });
    setViewMode("admin");
    setActiveTaskId(null);
    setWizardStep(1);
    setTempPhotos([]);
  };

  const handleAcceptTask = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, acceptanceStatus: "accepted", status: "accepted" } : t
    ));
    patchTask(taskId, { status: "accepted" });
  };

  const handleDeclineTask = (taskId: string, reason?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newDeclinedIds = [...(task.declinedByIds || []), ...(task.assigneeId ? [task.assigneeId] : [])];
    const nextAssignee = autoAssignFromProperty(task.propertyId, newDeclinedIds);

    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      if (nextAssignee) {
        patchTask(taskId, { status: "assigned", assigneeId: nextAssignee.id, assigneeName: nextAssignee.name, assigneeAvatar: nextAssignee.avatar, declinedByIds: newDeclinedIds, rejectionReason: reason ?? null });
        return { ...t, declinedByIds: newDeclinedIds, rejectionReason: reason || t.rejectionReason, assigneeId: nextAssignee.id, assigneeName: nextAssignee.name, assigneeAvatar: nextAssignee.avatar, acceptanceStatus: "pending", status: "assigned" };
      }
      patchTask(taskId, { status: "rejected", declinedByIds: newDeclinedIds, rejectionReason: reason ?? null });
      return { ...t, declinedByIds: newDeclinedIds, rejectionReason: reason || t.rejectionReason, acceptanceStatus: "declined", status: "rejected" };
    }));
  };

  const handleStartCleaning = (taskId: string) => {
    const now = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: "in_progress", startTime: now } : t
    ));
    patchTask(taskId, { status: "in_progress", startTime: now });
    setWizardStep(1);
  };

  const handleValidateTask = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, isWaitingValidation: false, status: "completed" } : t
    ));
    patchTask(taskId, { status: "completed", isWaitingValidation: false });
    const task = tasks.find(t => t.id === taskId);
    if (task?.assigneeId) {
      setTeam(prev => prev.map(m =>
        m.id === task.assigneeId ? { ...m, completedTasks: m.completedTasks + 1, tasksToday: Math.max(0, m.tasksToday - 1) } : m
      ));
    }
  };

  // ─── Detail modal — owner-side drawer con auditoria + checklist + fotos ──
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = useMemo(
    () => tasks.find(t => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  );

  // Carga real por staff member derivada del state de tasks. Antes los
  // contadores `tasksToday`/`completedTasks` venian de MOCK_TEAM (numeros
  // hardcodeados), lo cual contradecia los KPIs y el cronograma. Ahora
  // viene de la verdad: las tareas que el state ya tiene cargadas.
  const todayStrLocal = getDateStr(0);
  const staffLoad = useMemo(() => {
    const map = new Map<string, { tasksToday: number; completedTasks: number }>();
    for (const t of tasks) {
      if (!t.assigneeId) continue;
      const cur = map.get(t.assigneeId) ?? { tasksToday: 0, completedTasks: 0 };
      const eff = getEffectiveStatus(t);
      if (t.dueDate === todayStrLocal && eff !== "completed") cur.tasksToday += 1;
      if (eff === "completed") cur.completedTasks += 1;
      map.set(t.assigneeId, cur);
    }
    return map;
  }, [tasks, todayStrLocal]);

  // Memoizamos la proyeccion ligera de team y properties para que el modal
  // no re-renderice por arrays nuevos en cada render del Panel.
  const detailTeam = useMemo(
    () => team.map(m => ({ id: m.id, name: m.name, avatar: m.avatar, phone: m.phone })),
    [team],
  );
  const detailProperties = useMemo(
    () => properties.map(p => ({
      id: p.id,
      name: p.name,
      bedConfiguration: p.bedConfiguration,
      evidenceCriteria: p.evidenceCriteria,
      address: p.address,
      addressUnit: p.addressUnit,
      neighborhood: p.neighborhood,
      city: p.city,
      accessMethod: p.accessMethod,
      keyboxCode: p.keyboxCode,
      keyboxLocation: p.keyboxLocation,
      keyboxPhotoUrl: p.keyboxPhotoUrl,
    })),
    [properties],
  );

  const handleReassignFromDetail = (taskId: string, memberId: string | null) => {
    const member = memberId ? team.find(m => m.id === memberId) : null;
    // El nuevo asignado todavia no acepto/inicio: pasamos a "assigned"
    // (o "unassigned" si se quita el asignado). Misma logica en state y BD.
    const nextStatus: CleaningTask["status"] = member ? "assigned" : "unassigned";
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? {
            ...t,
            assigneeId: member?.id,
            assigneeName: member?.name,
            assigneeAvatar: member?.avatar,
            status: nextStatus,
          }
        : t,
    ));
    patchTask(taskId, {
      assigneeId: member?.id ?? null,
      assigneeName: member?.name ?? null,
      assigneeAvatar: member?.avatar ?? null,
      status: nextStatus,
    });
  };

  const handleReopenFromDetail = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status: t.assigneeId ? "assigned" : "unassigned", isWaitingValidation: false }
        : t,
    ));
    const t = tasks.find(x => x.id === taskId);
    patchTask(taskId, {
      status: t?.assigneeId ? "assigned" : "unassigned",
      isWaitingValidation: false,
    });
  };

  const handleMarkUrgentFromDetail = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, priority: "critical" } : t,
    ));
    patchTask(taskId, { priority: "critical" });
  };

  // ─── Staff Views Renderers ───────────────────────────────────────────────

  const renderStaffHome = () => {
    // Filter logic for staff
    const myTasks = tasks.filter(t => t.assigneeId === "1"); // Hardcoded Laura for demo
    
    const staffSummary = {
      urgent: myTasks.filter(t => t.dueDate === getDateStr(0) && parseInt(t.dueTime.split(":")[0]) < 6).length,
      pending: myTasks.filter(t => t.acceptanceStatus === "pending").length,
      today: myTasks.filter(t => t.dueDate === getDateStr(0)).length,
      week: myTasks.length
    };

    const filteredTasksByTime = myTasks.filter(t => {
      if (staffTimeFilter === "today") return t.dueDate === getDateStr(0);
      if (staffTimeFilter === "tomorrow") return t.dueDate === getDateStr(1);
      return true; // Week view
    }).sort((a, b) => {
      // Sort by urgency primarily, then time
      const aInfo = getPriorityInfo(a);
      const bInfo = getPriorityInfo(b);
      if (aInfo.isUrgent && !bInfo.isUrgent) return -1;
      if (!aInfo.isUrgent && bInfo.isUrgent) return 1;
      return a.dueTime.localeCompare(b.dueTime);
    });

    return (
      <div className="min-h-screen bg-[#F8F9FC] pb-24">
        {/* Cabecera Operativa */}
        <div className="bg-white px-6 pt-12 pb-6 shadow-sm sticky top-0 z-20">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-primary/10">
                <AvatarImage src={team.find(m => m.id === "1")?.avatar} />
                <AvatarFallback>LS</AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-xl font-black text-slate-800">Laura Sánchez</h2>
                <p className="text-xs font-bold text-slate-400">Personal de Limpieza</p>
              </div>
            </div>
            <div className="h-10 w-10 flex items-center justify-center bg-primary/5 rounded-full">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className={cn("p-3 rounded-2xl border text-center transition-all", staffSummary.urgent > 0 ? "bg-rose-50 border-rose-100 ring-1 ring-rose-200" : "bg-slate-50 border-slate-100")}>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Urgentes</p>
              <p className={cn("text-xl font-black", staffSummary.urgent > 0 ? "text-rose-600" : "text-slate-600")}>{staffSummary.urgent}</p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Pendientes</p>
              <p className="text-xl font-black text-slate-600">{staffSummary.pending}</p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Total Hoy</p>
              <p className="text-xl font-black text-slate-600">{staffSummary.today}</p>
            </div>
          </div>

          {/* Time Tabs Filter */}
          <div className="flex bg-slate-100 p-1 rounded-2xl">
            {(["today", "tomorrow", "week"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStaffTimeFilter(f)}
                className={cn(
                  "flex-1 py-2.5 text-[10px] uppercase tracking-widest font-black rounded-xl transition-all",
                  staffTimeFilter === f ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {f === "today" ? "Hoy" : f === "tomorrow" ? "Mañana" : "Semana"}
              </button>
            ))}
          </div>
        </div>

        {/* Task List (Compact Mode) */}
        <div className="px-6 mt-6 space-y-3">
          {filteredTasksByTime.length > 0 ? (
            filteredTasksByTime.map(task => {
              const info = getPriorityInfo(task);
              const isMaintenance = task.guestName.toLowerCase().includes("mantenimiento") || task.priority === "critical"; // Example logic
              
              return (
                <div 
                  key={task.id}
                  onClick={() => {
                    setActiveTaskId(task.id);
                    setStaffAppScreen("task");
                  }}
                  className={cn(
                    "relative bg-white rounded-2xl border flex items-stretch overflow-hidden active:scale-[0.98] transition-all cursor-pointer h-20 mb-3",
                    info.isUrgent ? "border-rose-200 shadow-md shadow-rose-50" : "border-slate-100"
                  )}
                >
                  <div className={cn("w-2", info.color.split(" ")[1])}></div>
                  <div className="flex-1 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-100 relative shadow-inner">
                        <img src={task.propertyImage} className="h-full w-full object-cover" />
                        {isMaintenance && (
                          <div className="absolute inset-0 bg-primary/40 flex items-center justify-center">
                             <Wrench className="h-5 w-5 text-white" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-slate-800 text-sm truncate max-w-[120px]">{task.propertyName}</h4>
                          {task.status === "in_progress" && <span className="h-2 w-2 rounded-full bg-primary animate-pulse"></span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1 border-none", info.color)}>
                            {info.label}
                          </Badge>
                          <span className="text-[10px] font-bold text-slate-500">Salida {task.dueTime}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-2">
                       <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shadow-sm border", task.status === "completed" ? "bg-emerald-50 border-emerald-100 text-emerald-500" : "bg-white border-slate-100 text-slate-400")}>
                         {task.status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                       </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-20 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
              <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                <Box className="h-10 w-10 text-slate-200" />
              </div>
              <p className="text-slate-400 text-sm font-bold">No hay limpiezas programadas</p>
            </div>
          )}
        </div>
        {/* Floating Logout for Demo */}
        <Button 
          variant="outline" 
          size="sm" 
          className="fixed bottom-6 right-6 rounded-full shadow-2xl h-12 px-6 border-slate-200 bg-white"
          onClick={() => {
            window.history.pushState({}, '', '/dashboard');
            window.location.reload(); 
          }}
        >
          <LogOut className="h-4 w-4 mr-2" /> Salir del Portal
        </Button>
      </div>
    );
  };

  if (viewMode === "staff") {
    if (staffAppScreen === "home") return renderStaffHome();

    if (!currentActiveTask) return renderStaffHome();

    // Screen: Task Detail / Start
    if (["pending", "assigned", "accepted", "issue"].includes(currentActiveTask.status)) {
       return (
         <StaffTaskDetail 
           task={currentActiveTask as any}
           bedConfiguration={properties.find(p => p.id === currentActiveTask.propertyId)?.bedConfiguration}
           onClose={() => setStaffAppScreen("home")}
           onAccept={handleAcceptTask}
           onDecline={handleDeclineTask}
           onStartCleaning={handleStartCleaning}
         />
       );
    }

    // Screen: Wizard (Step 1, 2, 3) 
    return (
      <StaffWizard
        task={currentActiveTask as any}
        activeCriteria={activeCriteria}
        onClose={() => setStaffAppScreen("home")}
        onSubmit={(taskId, photos) => handleSubmitTask()}
        onToggleChecklist={toggleChecklistItem}
      />
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestión operativa</h2>
          <p className="text-muted-foreground">Sistema centralizado de limpieza y mantenimiento especializado</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as "day" | "week" | "month" | "validate")} className="w-auto">
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="day" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-4">Diaria</TabsTrigger>
              <TabsTrigger value="week" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-4">Semanal</TabsTrigger>
              <TabsTrigger value="month" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-4">Mensual</TabsTrigger>
              <TabsTrigger
                value="validate"
                className={cn(
                  "data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 gap-1.5",
                  stats.awaitingValidation > 0 && "text-rose-600 font-bold",
                )}
              >
                A validar
                {stats.awaitingValidation > 0 && (
                  <Badge className="bg-rose-500 text-white border-0 text-[10px] h-4 px-1.5 font-black animate-pulse">
                    {stats.awaitingValidation}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => setShowAddTask(true)} className="gradient-gold text-primary-foreground shadow-lg hover:shadow-primary/20 transition-all gap-2 px-6">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva Orden</span>
          </Button>
        </div>
      </div>

      {/* ─── Banner critico: tareas sin asignar con checkout < 24h ───────
          Es lo primero que el owner ve al abrir el modulo si hay riesgo
          real. Click → cambia el cronograma a una vista filtrada que
          muestra SOLO esas urgentes ordenadas de mas cercana a mas
          lejana. Vuelve a "Diaria" cuando el owner clickea otra pestana. */}
      {stats.unassignedUrgent > 0 && view !== "unassigned" && (
        <button
          type="button"
          onClick={() => setView("unassigned")}
          className="w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-200 hover:shadow-rose-300 transition-all animate-pulse-gentle text-left"
        >
          <div className="p-2 bg-white/20 rounded-xl flex-shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-black text-sm tracking-wide">
              {stats.unassignedUrgent} {stats.unassignedUrgent === 1 ? "tarea" : "tareas"} sin asignar
              {" "}con checkout en las proximas 24h
            </p>
            <p className="text-xs text-white/90 font-medium mt-0.5">
              Click para ver y asignar staff ahora
            </p>
          </div>
          <ArrowRight className="h-5 w-5 flex-shrink-0" />
        </button>
      )}

      {/* Breadcrumb cuando estamos en la vista filtrada — para que el
          owner sepa donde esta y como volver al cronograma normal. */}
      {view === "unassigned" && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0" />
            <div>
              <p className="font-black text-sm text-rose-900">
                Sin asignar urgente · proximas 24h
              </p>
              <p className="text-xs text-rose-700/80">
                Asignale staff y volve a la vista normal
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-rose-300 text-rose-700 hover:bg-rose-100"
            onClick={() => setView("day")}
          >
            Volver al cronograma
          </Button>
        </div>
      )}

      {/* ─── Top Dashboard Stats ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: `Checkouts ${period.short}`, value: stats.total, icon: LogOut, color: "text-primary", bg: "bg-primary/10", onClick: undefined as (() => void) | undefined, urgent: false },
          { label: `Back-to-Back ${period.short}`, value: stats.critical, icon: TrendingUp, color: "text-rose-600", bg: "bg-rose-100/50", onClick: undefined, urgent: false },
          { label: `Completadas ${period.short}`, value: stats.completed, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100/50", onClick: undefined, urgent: false },
          { label: `Pendientes ${period.short}`, value: stats.pending, icon: Clock, color: "text-muted-foreground", bg: "bg-muted", onClick: undefined, urgent: false },
          // 5to KPI: tareas que el staff envio y esperan aprobacion del owner.
          // Click → cambia la vista del cronograma a "A validar". Pulsa cuando
          // hay > 0 para que el owner las atienda al abrir el modulo.
          {
            label: "A validar",
            value: stats.awaitingValidation,
            icon: ClipboardList,
            color: stats.awaitingValidation > 0 ? "text-rose-600" : "text-muted-foreground",
            bg: stats.awaitingValidation > 0 ? "bg-rose-100/60" : "bg-muted",
            onClick: () => setView("validate"),
            urgent: stats.awaitingValidation > 0,
          },
        ].map((stat, i) => (
          <Card
            key={i}
            className={cn(
              "border-none shadow-soft overflow-hidden group",
              stat.onClick && "cursor-pointer hover:shadow-md transition-shadow",
              stat.urgent && "ring-2 ring-rose-200 animate-pulse",
            )}
            onClick={stat.onClick}
            role={stat.onClick ? "button" : undefined}
            tabIndex={stat.onClick ? 0 : undefined}
          >
            <CardContent className="p-5 flex items-center gap-4 relative">
              <div className={cn("p-3 rounded-2xl transition-all group-hover:scale-110", stat.bg)}>
                <stat.icon className={cn("h-6 w-6", stat.color)} />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Main Content ───────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-12 gap-6">
        
        {/* Left Column: Tasks and Planning */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Month calendar grid — vista mensual */}
          {view === "month" && (
            <div className="space-y-3 bg-white rounded-2xl border border-muted p-4 shadow-soft">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => shiftMonth(-1)}
                  className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4 text-slate-600" />
                </button>
                <div className="flex items-center gap-2 flex-1 justify-center">
                  <span className="font-bold uppercase text-slate-700 tracking-wider text-sm">
                    {monthLabel}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToToday}
                    className="h-7 text-[11px] font-bold border-primary/30 text-primary hover:bg-primary/5 px-3"
                  >
                    Hoy
                  </Button>
                </div>
                <button
                  onClick={() => shiftMonth(1)}
                  className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4 text-slate-600" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase text-slate-400 text-center">
                {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
                  <div key={d} className="py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map((cell, idx) => {
                  if (!cell.date) {
                    return <div key={idx} className="aspect-square" />;
                  }
                  const isActive = cell.date === activeDate;
                  const allDone = cell.total > 0 && cell.pending === 0;
                  return (
                    <button
                      key={idx}
                      onClick={() => setActiveDate(cell.date!)}
                      className={cn(
                        "aspect-square flex flex-col items-center justify-center rounded-xl border transition-all relative",
                        isActive
                          ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30"
                          : cell.isToday
                          ? "bg-amber-50 border-amber-200"
                          : "bg-white border-muted hover:border-primary/20 hover:bg-slate-50",
                      )}
                      title={
                        cell.total === 0
                          ? "Sin tareas"
                          : `${cell.pending} pendiente${cell.pending === 1 ? "" : "s"} · ${cell.total} total`
                      }
                    >
                      <span className={cn(
                        "text-sm font-bold",
                        isActive ? "text-primary" : cell.isToday ? "text-amber-700" : "text-slate-700",
                      )}>
                        {cell.day}
                      </span>
                      {cell.pending > 0 && (
                        <span className={cn(
                          "absolute bottom-1 text-[9px] font-black px-1.5 rounded-full",
                          isActive ? "bg-primary text-white" : "bg-amber-400 text-white",
                        )}>
                          {cell.pending}
                        </span>
                      )}
                      {allDone && (
                        <span className="absolute bottom-1 text-[9px] font-black px-1.5 rounded-full bg-emerald-500 text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Day selection for Weekly view */}
          {view === "week" && (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              {dayTabs.map((day) => {
                const isActive = day.date === activeDate;
                return (
                  <button
                    key={day.date}
                    onClick={() => setActiveDate(day.date)}
                    className={cn(
                      "flex flex-col items-center min-w-[70px] p-3 rounded-2xl transition-all border outline-none",
                      isActive 
                        ? "bg-primary/5 border-primary/20 ring-1 ring-primary/20" 
                        : "bg-white border-muted hover:border-primary/20 hover:bg-slate-50"
                    )}
                  >
                    <span className={cn(
                      "text-[10px] font-bold uppercase mb-1",
                      isActive ? "text-primary" : "text-slate-400"
                    )}>
                      {day.label}
                    </span>
                    <span className={cn(
                      "text-xl font-black",
                      isActive ? "text-primary" : "text-slate-700"
                    )}>
                      {new Date(day.date + "T00:00:00").getDate()}
                    </span>
                    <div className="flex gap-0.5 mt-2 h-1 justify-center">
                      {Array.from({ length: Math.min(day.count, 3) }).map((_, i) => (
                        <div key={i} className={cn(
                          "h-1 w-1 rounded-full",
                          isActive ? "bg-primary" : "bg-amber-400"
                        )} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              Cronograma de Actividades
            </h3>
            <div className="flex items-center gap-4">
               {/* View Toggle Trigger (Simulando link de WhatsApp) */}
               <Button 
                variant="outline" 
                size="sm" 
                className="gap-2 text-[11px] font-bold h-8 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => {
                  setViewMode("staff");
                  setStaffAppScreen("home");
                  setActiveTaskId(null);
                }}
               >
                 <ArrowRight className="h-3 w-3" /> Simular App Staff
               </Button>
               <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger className="w-[180px] h-9 bg-white shadow-sm">
                    <SelectValue placeholder="Filtrar por staff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todo el equipo</SelectItem>
                    {team.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
               </Select>
            </div>
          </div>

          <div className="space-y-4">
            {filteredTasks.length > 0 ? (
              (() => {
                // Conteo por dia para el header de seccion. Se calcula
                // una vez sobre filteredTasks para evitar O(n^2) en el render.
                const countByDay = new Map<string, number>();
                for (const t of filteredTasks) {
                  countByDay.set(t.dueDate, (countByDay.get(t.dueDate) ?? 0) + 1);
                }
                const todayStr = getDateStr(0);
                const tomorrowStr = getDateStr(1);
                const showHeaders = view === "week" || view === "month" || view === "validate" || view === "unassigned";

                return filteredTasks.map((task, idx) => {
                  const priority = getPriorityInfo(task);
                  const isWaitingReview = task.isWaitingValidation;
                  const prev = idx > 0 ? filteredTasks[idx - 1] : null;
                  const newDay = !prev || prev.dueDate !== task.dueDate;
                  const dayLabel =
                    task.dueDate === todayStr
                      ? "Hoy"
                      : task.dueDate === tomorrowStr
                        ? "Mañana"
                        : formatLongDate(task.dueDate);
                  const dayCount = countByDay.get(task.dueDate) ?? 0;

                  return (
                    <div key={task.id}>
                      {showHeaders && newDay && (
                        <div className="flex items-center gap-3 mb-2 mt-2 px-1">
                          <div className="h-px bg-border flex-1" />
                          <Badge
                            variant="outline"
                            className={cn(
                              "border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[10px]",
                              task.dueDate === todayStr && "bg-primary/10 text-primary border-primary/30",
                            )}
                          >
                            <Calendar className="h-3 w-3 mr-1" />
                            {dayLabel} · {dayCount} {dayCount === 1 ? "tarea" : "tareas"}
                          </Badge>
                          <div className="h-px bg-border flex-1" />
                        </div>
                      )}
                  <Card className={cn(
                    "group hover:shadow-xl transition-all duration-300 border-none shadow-soft overflow-hidden",
                    isWaitingReview && "ring-2 ring-amber-500 bg-amber-50/20",
                    priority.isUrgent && !isWaitingReview && "ring-2 ring-rose-500 bg-rose-50/10 animate-pulse-gentle"
                  )}>
                    <div className="flex flex-col md:flex-row">
                      {/* Property Thumbnail */}
                      <div className="md:w-48 h-32 md:h-auto relative overflow-hidden">
                        <img 
                          src={task.propertyImage} 
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                          alt={task.propertyName}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex flex-col justify-end gap-1">
                           {task.isVacant && (
                             <Badge className="bg-emerald-500 text-white border-0 text-[10px] w-fit font-black tracking-wider">
                               ✓ VACANTE
                             </Badge>
                           )}
                           {task.isBackToBack && !task.isVacant && (
                             <Badge className="bg-rose-500 text-white border-0 text-[10px] w-fit font-black animate-pulse tracking-wider">
                               ⚡ BACK-TO-BACK
                             </Badge>
                           )}
                           <div className="flex items-center justify-between">
                             <span className="text-white text-xs font-semibold">Salida {task.dueTime}</span>
                             {task.guestCount && (
                               <span className="text-white/80 text-[10px] font-medium">{task.guestCount} huéspedes</span>
                             )}
                           </div>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 p-5">
                        {/* Booking strip — codigo de reserva + canal + fecha completa */}
                        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-muted/60">
                          <Badge className={cn(
                            "text-white border-0 text-[10px] font-black tracking-wider px-2",
                            getChannelBadge(task).color,
                          )}>
                            {getChannelBadge(task).label}
                          </Badge>
                          <span className="font-mono text-xs font-bold text-slate-700 tracking-tight">
                            {getReservationCode(task)}
                          </span>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Salida {formatLongDate(task.dueDate)} · {formatTime12(task.dueTime)}
                          </span>
                          {(() => {
                            const nights = computeNights(task.bookingCheckIn, task.bookingCheckOut);
                            return nights ? (
                              <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[10px] h-5 font-bold border-0">
                                {nights} {nights === 1 ? "noche" : "noches"}
                              </Badge>
                            ) : null;
                          })()}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-lg font-bold group-hover:text-primary transition-colors">{task.propertyName}</h4>
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5" />
                              {task.address}
                            </div>
                            {task.bookingCheckIn && (
                              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                                <Clock className="h-3 w-3" />
                                Estancia: {formatLongDate(task.bookingCheckIn)} → {formatLongDate(task.dueDate)}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {getStatusBadge(task)}
                            <div className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border", priority.color)}>
                              <priority.icon className="h-3 w-3" />
                              {priority.label}
                            </div>
                            {(() => {
                              // Badge de urgencia dinamico para tareas sin
                              // asignar — escala desde gris ("3 dias") hasta
                              // rojo solido pulsante ("URGENTE · checkout HOY").
                              const urgency = getUnassignedUrgency(task);
                              if (urgency.level === "none") return null;
                              return (
                                <div
                                  className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 border rounded-full",
                                    urgency.classes,
                                    urgency.pulse && "animate-pulse",
                                  )}
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider">
                                    {urgency.label}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        <div className="flex flex-col md:flex-row md:items-center gap-6 py-4 border-t border-muted/50">
                           {/* Assignee Selection */}
                           <div className="flex items-center gap-3">
                              <div className="relative">
                                <Avatar className="h-10 w-10 border-2 border-white shadow-soft">
                                  <AvatarImage src={task.assigneeAvatar} />
                                  <AvatarFallback className="bg-muted text-xs">{task.assigneeName?.charAt(0) || "U"}</AvatarFallback>
                                </Avatar>
                                {task.assigneeId && <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 bg-emerald-500 rounded-full border-2 border-white" />}
                              </div>
                              <div className="flex items-center gap-2">
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground uppercase mb-0.5">Asignado a</p>
                                  <Select
                                    value={task.assigneeId || "none"}
                                    onValueChange={(value) =>
                                      handleReassignFromDetail(task.id, value === "none" ? null : value)
                                    }
                                  >
                                    <SelectTrigger className="h-7 border-none p-0 bg-transparent font-semibold focus:ring-0">
                                      <SelectValue placeholder="Sin asignar" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">Sin asignar</SelectItem>
                                      {team.map(m => (
                                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {task.assigneeId && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-8 w-8 p-0 rounded-full text-emerald-600 hover:bg-emerald-50 transition-colors"
                                    onClick={() => handleSendMessage(team.find(m => m.id === task.assigneeId)?.phone || "", task.propertyName, task.id)}
                                    title="Contactar por WhatsApp"
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                           </div>

                           {/* Guest Info (Out/In) */}
                           <div className="flex-1 px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                 <div className="h-8 w-8 rounded-full bg-white flex items-center justify-center text-slate-400 shadow-sm flex-shrink-0">
                                    <User className="h-4 w-4" />
                                 </div>
                                 <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6 min-w-0">
                                    <div className="min-w-0">
                                       <p className="text-[9px] uppercase text-muted-foreground font-bold leading-none mb-1">
                                         Huésped saliente {task.guestCount ? `· ${task.guestCount} pax` : ""}
                                       </p>
                                       <p className="text-sm font-bold text-slate-800 truncate">{task.guestName}</p>
                                    </div>
                                    {task.isBackToBack && task.arrivingGuestName && (
                                       <div className="pt-2 sm:pt-0 sm:pl-4 sm:border-l border-slate-200 min-w-0">
                                          <p className="text-[9px] uppercase text-emerald-600 font-bold leading-none mb-1">
                                            Entrada hoy {task.arrivingGuestCount ? `· ${task.arrivingGuestCount} pax` : ""}
                                          </p>
                                          <p className="text-sm font-bold text-slate-700 truncate">{task.arrivingGuestName}</p>
                                       </div>
                                    )}
                                 </div>
                              </div>
                              {task.guestPhone && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-emerald-600 hover:bg-emerald-50 flex-shrink-0"
                                  onClick={() => {
                                    const phone = task.guestPhone!.replace(/\D/g, "");
                                    const msg = encodeURIComponent(`Hola ${task.guestName}, te escribo de ${task.propertyName}. ¿Todo bien con tu estancia?`);
                                    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
                                  }}
                                  title="WhatsApp al huésped"
                                >
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              )}
                           </div>

                           {/* Bed config badge */}
                           {properties.find(p => p.id === task.propertyId)?.bedConfiguration && (
                             <div className="flex items-center gap-1.5 px-3 py-2 bg-primary/5 rounded-xl border border-primary/10">
                               <Bed className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                               <span className="text-[11px] font-semibold text-primary truncate max-w-[120px]">
                                 {properties.find(p => p.id === task.propertyId)?.bedConfiguration}
                               </span>
                             </div>
                           )}
                        </div>

                        {/* Standard Instructions */}
                        {task.standardInstructions && (
                          <div className="mt-3 px-3 py-2.5 bg-amber-50/60 border border-amber-200/60 rounded-xl flex gap-2">
                            <Layers className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-800 leading-relaxed line-clamp-2">{task.standardInstructions}</p>
                          </div>
                        )}

                        {/* Checklist Preview */}
                        <div className="mt-4 flex items-center gap-4">
                           <div className="flex-1">
                              {(() => {
                                // El API devuelve `checklist: []` (legacy) y el real
                                // viene en `checklistItems`. Usar el real evita NaN%
                                // cuando la lista esta vacia o el legacy no se llena.
                                const items = task.checklistItems ?? [];
                                const total = items.length;
                                const done = items.filter(i => i.done).length;
                                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                return (
                                  <>
                                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider mb-2">
                                      <span className="text-muted-foreground">Progreso de limpieza</span>
                                      <span className={cn(
                                        task.status === "completed" ? "text-emerald-600" : "text-primary"
                                      )}>
                                        {pct}%
                                      </span>
                                    </div>
                                    <Progress value={pct} className="h-1.5" />
                                  </>
                                );
                              })()}
                           </div>
                           <Button
                              variant="outline"
                              size="sm"
                              className="h-9 gap-2 group/btn"
                              onClick={() => setDetailTaskId(task.id)}
                            >
                               {isWaitingReview ? "Validar Reporte" : "Ver Detalles"}
                               <ChevronRight className="h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
                            </Button>
                            
                            {isWaitingReview && (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="h-9 border-amber-300 text-amber-700 bg-amber-50">
                                   <ImageIcon className="h-4 w-4 mr-2" /> {task.closurePhotos?.length} Fotos
                                </Button>
                                <Button 
                                  size="sm" 
                                  className="h-9 bg-emerald-600 text-white hover:bg-emerald-700 gap-2"
                                  onClick={() => handleValidateTask(task.id)}
                                >
                                   <CheckCircle2 className="h-4 w-4" /> Validar y Cerrar
                                </Button>
                              </div>
                            )}
                         </div>
                      </div>
                    </div>
                  </Card>
                    </div>
                  );
                });
              })()
            ) : (
              view === "validate" ? (
                <div className="text-center py-20 bg-emerald-50/40 rounded-3xl border-2 border-dashed border-emerald-200">
                  <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h4 className="font-semibold text-lg text-emerald-900">Nada por validar</h4>
                  <p className="text-emerald-700/70 max-w-xs mx-auto mt-1">
                    El staff no envio reportes pendientes. Cuando completen una limpieza apareceran aca para que las apruebes.
                  </p>
                </div>
              ) : view === "unassigned" ? (
                <div className="text-center py-20 bg-emerald-50/40 rounded-3xl border-2 border-dashed border-emerald-200">
                  <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h4 className="font-semibold text-lg text-emerald-900">Todo bajo control</h4>
                  <p className="text-emerald-700/70 max-w-xs mx-auto mt-1">
                    No hay tareas sin asignar con checkout en las proximas 24h. Buen trabajo.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setView("day")}
                  >
                    Volver al cronograma
                  </Button>
                </div>
              ) : (
                <div className="text-center py-20 bg-muted/20 rounded-3xl border-2 border-dashed border-muted">
                  <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <Calendar className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h4 className="font-semibold text-lg">No hay tareas programadas</h4>
                  <p className="text-muted-foreground max-w-xs mx-auto mt-1">
                    Relájate, hoy parece que no tienes checkouts en tu calendario.
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Team and Insights */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-none shadow-soft overflow-hidden">
            <CardHeader className="bg-primary/5 pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Staff Disponible
                </CardTitle>
                <Badge variant="outline" className="border-primary/20 text-primary">{team.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-1.5">
              {/* Lista compacta: una linea por miembro con avatar + counters
                  inline. Antes era un card grande con avatar de 40px y
                  flecha hover; ahora es scannable en un vistazo. */}
              {team.map((member) => {
                const load = staffLoad.get(member.id) ?? { tasksToday: 0, completedTasks: 0 };
                const intensityColor = load.tasksToday > 3
                  ? "text-orange-500"
                  : load.tasksToday > 0
                    ? "text-emerald-500"
                    : "text-slate-400";
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-muted/40 transition-colors"
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={member.avatar} />
                      <AvatarFallback className="text-[10px]">{member.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm flex-1 truncate">{member.name}</p>
                    <span className={cn("text-xs font-bold tabular-nums", intensityColor)}>
                      {load.tasksToday}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">hoy</span>
                  </div>
                );
              })}

              {/* Mini-indicator de asignacion automatica — no una card aparte.
                  Solo aparece si hay al menos una propiedad configurada. */}
              {properties.some(p => p.autoAssignCleaner) && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.location.href = "/dashboard?panel=properties";
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-emerald-50 transition-colors group"
                >
                  <Bot className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-xs text-emerald-900 flex-1">
                    Auto-asignacion activa en{" "}
                    <span className="font-bold">
                      {properties.filter(p => p.autoAssignCleaner).length}
                    </span>{" "}
                    propiedad{properties.filter(p => p.autoAssignCleaner).length === 1 ? "" : "es"}
                  </p>
                  <ArrowRight className="h-3.5 w-3.5 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full h-9 border-dashed border hover:border-primary/50 gap-1.5 font-semibold text-xs"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.location.href = "/dashboard?panel=team";
                  }
                }}
              >
                <UserPlus className="h-3.5 w-3.5 text-primary" />
                Invitar al equipo
              </Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-soft">
             <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                   <AlertCircle className="h-5 w-5 text-rose-500" />
                   Incidencias activas
                   {incidents.length > 0 && (
                     <Badge variant="outline" className="border-rose-200 text-rose-600 ml-auto">
                       {incidents.length}
                     </Badge>
                   )}
                </CardTitle>
             </CardHeader>
             <CardContent className="p-4 pt-0 space-y-2">
                {incidents.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-emerald-50/50 border border-emerald-100 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-900">Sin incidencias activas</p>
                      <p className="text-xs text-emerald-700/70">Todas las propiedades estan operativas</p>
                    </div>
                  </div>
                ) : (
                  incidents.slice(0, 5).map((ticket) => {
                    const isCritical = ticket.severity === "critical" || ticket.severity === "high";
                    const photo = ticket.photos[0];
                    return (
                      <div
                        key={ticket.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            window.location.href = `/dashboard?panel=maintenance&ticket=${ticket.id}`;
                          }
                        }}
                        className={cn(
                          "p-3 rounded-2xl border flex gap-3 items-start cursor-pointer transition-all hover:shadow-md group",
                          isCritical
                            ? "bg-rose-50 border-rose-100 hover:border-rose-200"
                            : "bg-amber-50 border-amber-100 hover:border-amber-200",
                        )}
                      >
                        <div className="p-2 h-fit bg-white rounded-xl shadow-sm flex-shrink-0">
                          <AlertCircle className={cn("h-4 w-4", isCritical ? "text-rose-500" : "text-amber-500")} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-sm font-bold truncate", isCritical ? "text-rose-900" : "text-amber-900")}>
                              {ticket.title}
                            </p>
                            <ArrowRight className={cn("h-4 w-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity", isCritical ? "text-rose-500" : "text-amber-500")} />
                          </div>
                          <p className={cn("text-xs truncate", isCritical ? "text-rose-700/70" : "text-amber-700/70")}>
                            {ticket.propertyName ?? "—"}
                            {ticket.reportedByName ? ` • Reportado por ${ticket.reportedByName}` : ""}
                          </p>
                          {/* Estado de asignacion del ticket: si hay proveedor
                              asignado lo mostramos con su rol; si no, signal de
                              "todavia sin proveedor asignado". */}
                          <div className="flex items-center gap-1.5 mt-1.5 mb-1">
                            {ticket.assigneeName ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] h-5 font-bold gap-1">
                                <Wrench className="h-3 w-3" />
                                {ticket.assigneeName}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px] h-5 font-bold animate-pulse">
                                Sin proveedor asignado
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-slate-200 text-slate-500 font-bold uppercase">
                              {MAINTENANCE_CATEGORY_LABELS[ticket.category]}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-slate-200 text-slate-500 font-bold uppercase">
                              {MAINTENANCE_SEVERITY_LABELS[ticket.severity]}
                            </Badge>
                            {photo && (
                              <a
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={cn("text-[10px] font-bold underline", isCritical ? "text-rose-600" : "text-amber-700")}
                              >
                                Ver foto
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {incidents.length > 5 && (
                  <p className="text-[11px] text-center text-muted-foreground font-semibold pt-1">
                    + {incidents.length - 5} mas
                  </p>
                )}
             </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Modal: Nueva Orden ──────────────────────────────────────────── */}
      {showAddTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddTask(false)} />
          <div className="relative w-full max-w-md bg-background rounded-2xl shadow-2xl border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 pb-4 bg-gradient-to-r from-primary/5 via-primary/10 to-transparent border-b flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Plus className="h-5 w-5 text-primary" />
                  Nueva Orden de Limpieza
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">El limpiador se asignará automáticamente si la propiedad lo tiene configurado</p>
              </div>
              <button type="button" title="Cerrar" onClick={() => setShowAddTask(false)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
              {/* Propiedad */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Propiedad *</Label>
                <Select value={newTaskForm.propertyId} onValueChange={(v) => setNewTaskForm(prev => ({ ...prev, propertyId: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Selecciona una propiedad" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          {p.name}
                          {p.autoAssignCleaner && <Bot className="h-3.5 w-3.5 text-emerald-500" />}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newTaskForm.propertyId && properties.find(p => p.id === newTaskForm.propertyId)?.autoAssignCleaner && (
                  <div className="flex items-center gap-2 p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                    <Bot className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 font-medium">Se asignará automáticamente al primer limpiador disponible</p>
                  </div>
                )}
              </div>

              {/* Fecha y Hora */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fecha</Label>
                  <Input type="date" value={newTaskForm.dueDate} onChange={(e) => setNewTaskForm(prev => ({ ...prev, dueDate: e.target.value }))} className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hora de salida</Label>
                  <Input type="time" value={newTaskForm.dueTime} onChange={(e) => setNewTaskForm(prev => ({ ...prev, dueTime: e.target.value }))} className="h-10" />
                </div>
              </div>

              {/* Nombre del Huésped + Cantidad */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nombre del Huésped</Label>
                  <Input placeholder="Ej: Ana García" value={newTaskForm.guestName} onChange={(e) => setNewTaskForm(prev => ({ ...prev, guestName: e.target.value }))} className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Huéspedes</Label>
                  <Input type="number" min="1" placeholder="2" value={newTaskForm.guestCount} onChange={(e) => setNewTaskForm(prev => ({ ...prev, guestCount: e.target.value }))} className="h-10" />
                </div>
              </div>

              {/* Prioridad */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prioridad</Label>
                <Select value={newTaskForm.priority} onValueChange={(v) => setNewTaskForm(prev => ({ ...prev, priority: v as CleaningTask["priority"] }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baja</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Configuración de Urgencia */}
              <div className="space-y-3 pt-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Estado de la Propiedad</Label>
                <div className="grid gap-2">
                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-xl border transition-all duration-300",
                    newTaskForm.isBackToBack ? "bg-rose-50 border-rose-200 shadow-sm" : "bg-muted/20 border-border"
                  )}>
                    <div className="flex-1 pr-4">
                      <p className={cn("text-sm font-bold transition-colors", newTaskForm.isBackToBack ? "text-rose-700" : "text-foreground")}>Back-to-back</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">Check-in inmediato el mismo día — Alta prioridad</p>
                    </div>
                    <button
                      type="button"
                      title={newTaskForm.isBackToBack ? "Desactivar back-to-back" : "Activar back-to-back"}
                      onClick={() => setNewTaskForm(prev => ({ ...prev, isBackToBack: !prev.isBackToBack, isVacant: false }))}
                      className={cn(
                        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                        newTaskForm.isBackToBack ? "bg-rose-500" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          newTaskForm.isBackToBack ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-xl border transition-all duration-300",
                    newTaskForm.isVacant ? "bg-emerald-50 border-emerald-200 shadow-sm" : "bg-muted/20 border-border"
                  )}>
                    <div className="flex-1 pr-4">
                      <p className={cn("text-sm font-bold transition-colors", newTaskForm.isVacant ? "text-emerald-700" : "text-foreground")}>Propiedad Vacante</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">Sin nuevo check-in hoy — Baja urgencia</p>
                    </div>
                    <button
                      type="button"
                      title={newTaskForm.isVacant ? "Desactivar vacante" : "Marcar como vacante"}
                      onClick={() => setNewTaskForm(prev => ({ ...prev, isVacant: !prev.isVacant, isBackToBack: false }))}
                      className={cn(
                        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                        newTaskForm.isVacant ? "bg-emerald-500" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          newTaskForm.isVacant ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddTask(false)}>Cancelar</Button>
              <Button
                onClick={handleCreateTask}
                disabled={!newTaskForm.propertyId}
                className="gradient-gold text-primary-foreground gap-2"
              >
                <Plus className="h-4 w-4" />
                Crear Orden
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Detail drawer (owner-side) ──────────────────────────────────── */}
      <CleaningTaskDetailModal
        task={detailTask}
        team={detailTeam}
        properties={detailProperties}
        onClose={() => setDetailTaskId(null)}
        onReassign={handleReassignFromDetail}
        onValidate={(taskId) => { handleValidateTask(taskId); setDetailTaskId(null); }}
        onReopen={(taskId) => { handleReopenFromDetail(taskId); setDetailTaskId(null); }}
        onMarkUrgent={handleMarkUrgentFromDetail}
      />
    </div>
  );
}
