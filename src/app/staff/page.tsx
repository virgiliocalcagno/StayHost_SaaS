"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { logoutAndRedirect } from "@/lib/auth/logout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Wrench,
  Box,
  LogOut,
  Eye,
  EyeOff,
} from "lucide-react";
interface StaffSession {
  memberId: string;
  name: string;
  role: string;
  available: boolean;
}

import { StaffWizard } from "@/components/staff-ui/StaffWizard";
import { StaffTaskDetail } from "@/components/staff-ui/StaffTaskDetail";
import { useTableSync } from "@/lib/realtime/useTableSync";
import { CleaningTask, getPriorityInfo } from "@/types/staff";

interface Property {
  id: string;
  name: string;
  address?: string;
  bedConfiguration?: string;
  evidenceCriteria?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Local date YYYY-MM-DD, not UTC — fixes "Hoy" rolling to the next day after
// ~8pm in west-of-UTC timezones.
const getDateStr = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Mapper de fila API → DTO de UI. La API devuelve todo en camelCase (ver
// /api/cleaning-tasks GET). Mantenemos los fallbacks snake_case por si en
// algún momento el contrato cambia.
const pickStr = (...vals: unknown[]) => {
  for (const v of vals) {
    if (typeof v === "string" && v) return v;
  }
  return undefined;
};
const mapApiTask = (t: Record<string, unknown>): CleaningTask => ({
  id: t.id as string,
  propertyId: (t.propertyId ?? t.property_id ?? "") as string,
  propertyName: (t.propertyName ?? t.property_name ?? "Propiedad") as string,
  address: (t.address ?? "") as string,
  propertyImage: pickStr(t.propertyImage, t.property_image, t.cover_image),
  assigneeId: pickStr(t.assigneeId, t.assignee_id),
  assigneeName: pickStr(t.assigneeName, t.assignee_name),
  dueDate: (t.dueDate ?? t.due_date ?? "") as string,
  dueTime: (t.dueTime ?? t.due_time ?? "12:00") as string,
  status: (t.status ?? "pending") as CleaningTask["status"],
  priority: (t.priority ?? "medium") as CleaningTask["priority"],
  isBackToBack: (t.isBackToBack ?? t.is_back_to_back ?? false) as boolean,
  isVacant: (t.isVacant ?? t.is_vacant) as boolean | undefined,
  guestName: (t.guestName ?? t.guest_name ?? "") as string,
  guestCount: (t.guestCount ?? t.guest_count) as number | undefined,
  guestPhone: pickStr(t.guestPhone, t.guest_phone),
  stayDuration: (t.stayDuration ?? t.stay_duration) as number | undefined,
  checklist: [],
  checklistItems: (t.checklistItems ?? t.checklist_items ?? []) as CleaningTask["checklistItems"],
  closurePhotos: (t.closurePhotos ?? t.closure_photos ?? []) as CleaningTask["closurePhotos"],
  reportedIssues: (t.reportedIssues ?? t.reported_issues ?? []) as string[],
  isWaitingValidation: (t.isWaitingValidation ?? t.is_waiting_validation ?? false) as boolean,
  startTime: pickStr(t.startTime, t.start_time),
  declinedByIds: (t.declinedByIds ?? t.declined_by_ids ?? []) as string[],
  rejectionReason: pickStr(t.rejectionReason, t.rejection_reason),
  rejectionNote: pickStr(t.rejectionNote, t.rejection_note),
  validatedAt: pickStr(t.validatedAt, t.validated_at),
  validatedBy: pickStr(t.validatedBy, t.validated_by),
  acceptanceStatus: (t.acceptanceStatus ?? t.acceptance_status ?? "pending") as CleaningTask["acceptanceStatus"],
  standardInstructions: pickStr(t.standardInstructions, t.standard_instructions),
  // Campos extendidos — el API ya los devuelve, antes el mapper los tiraba.
  arrivingGuestName: pickStr(t.arrivingGuestName, t.arriving_guest_name),
  arrivingGuestCount: (t.arrivingGuestCount ?? t.arriving_guest_count) as number | undefined,
  arrivingCheckInTime: (t.arrivingCheckInTime ?? null) as string | null,
  bookingId: pickStr(t.bookingId, t.booking_id),
  bookingChannel: pickStr(t.bookingChannel),
  bookingChannelCode: pickStr(t.bookingChannelCode),
  bookingCheckIn: pickStr(t.bookingCheckIn),
  bookingCheckOut: pickStr(t.bookingCheckOut),
  // Acceso
  accessMethod: (t.accessMethod ?? null) as CleaningTask["accessMethod"],
  accessPin: (t.accessPin ?? null) as string | null,
  keyboxCode: (t.keyboxCode ?? null) as string | null,
  keyboxLocation: (t.keyboxLocation ?? null) as string | null,
  wifiName: (t.wifiName ?? null) as string | null,
  wifiPassword: (t.wifiPassword ?? null) as string | null,
  checkInTime: (t.checkInTime ?? null) as string | null,
  checkOutTime: (t.checkOutTime ?? null) as string | null,
});

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  co_host: "Co-anfitrión",
  cleaner: "Personal de Limpieza",
  maintenance: "Mantenimiento",
  guest_support: "Soporte",
  owner: "Propietario",
  accountant: "Contador",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function StaffPage() {
  const router = useRouter();

  // ─── Auth & data state ────────────────────────────────────────────────────
  const [session, setSession] = useState<StaffSession | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [ownerWhatsapp, setOwnerWhatsapp] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  // ─── Navigation state ─────────────────────────────────────────────────────
  const [screen, setScreen] = useState<"home" | "task">("home");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [staffTimeFilter, setStaffTimeFilter] = useState<"today" | "tomorrow" | "week">("today");

  // ─── Wizard state ─────────────────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState(1);
  const [tempPhotos, setTempPhotos] = useState<{ category: string; url: string }[]>([]);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    function loadFromLocalStorage(): boolean {
      const raw = localStorage.getItem("stayhost_session");
      if (!raw) return false;
      try {
        const sess = JSON.parse(raw) as StaffSession;
        setSession(sess);
        setAvailable(sess.available);
        const rawTasks = localStorage.getItem("stayhost_tasks");
        if (rawTasks) setTasks(JSON.parse(rawTasks));
        const rawProps = localStorage.getItem("stayhost_properties");
        if (rawProps) setProperties(JSON.parse(rawProps));
        return true;
      } catch { return false; }
    }

    async function initSession() {
      try {
        // 1. /api/me ahora resuelve memberId, name y role en una sola
        // query (lookup por auth_user_id en team_members). El frontend
        // ya no necesita pegarle a /api/team-members ni hacer match por
        // email — eso fallaba para staff con pseudo-email.
        const meRes = await fetch("/api/me");
        if (!meRes.ok) throw new Error("api/me failed");
        const me = (await meRes.json()) as {
          email: string | null;
          tenantId: string | null;
          isMaster: boolean;
          role: string | null;
          memberId: string | null;
          name: string | null;
        };

        if (cancelled) return;

        if (!me.email || !me.tenantId) {
          if (!loadFromLocalStorage()) router.replace("/acceso");
          return;
        }

        setTenantId(me.tenantId);

        // 2. Si el user está autenticado y es Master pero no tiene team_member,
        // mostramos su email como name (caso owner sin auto-seed). Para
        // staff normal usamos memberId + name del DTO.
        const sess: StaffSession = {
          memberId: me.memberId ?? me.tenantId,
          name: me.name ?? (me.isMaster ? "Owner" : (me.email.split("@")[0] || "Staff")),
          role: me.role ?? (me.isMaster ? "owner" : "cleaner"),
          available: true, // BD ya lo tiene; UI lo lee de session local hasta el primer toggle
        };

        localStorage.setItem("stayhost_session", JSON.stringify(sess));
        setSession(sess);
        setAvailable(sess.available);

        // 3. Fetch real tasks from backend
        const tasksRes = await fetch("/api/cleaning-tasks");
        if (tasksRes.ok && !cancelled) {
          const tasksData = await tasksRes.json();
          const realTasks = (tasksData.tasks ?? tasksData ?? []).map(mapApiTask);
          setTasks(realTasks);
          localStorage.setItem("stayhost_tasks", JSON.stringify(realTasks));
          if (typeof tasksData.ownerWhatsapp === "string") {
            setOwnerWhatsapp(tasksData.ownerWhatsapp);
          }
        }

        // 4. Fetch properties — endpoint correcto es /api/properties (antes
        // pegaba a /api/bookings, que casualmente devolvía un sub-array
        // `properties` pero rompería el día que ese contrato cambie).
        const propsRes = await fetch("/api/properties");
        if (propsRes.ok && !cancelled) {
          const propsData = await propsRes.json();
          const realProps = (propsData.properties ?? []).map((p: Record<string, unknown>) => ({
            id: p.id,
            name: p.name ?? "",
            address: p.address,
            bedConfiguration: p.bed_configuration ?? p.bedConfiguration,
            evidenceCriteria: p.evidence_criteria ?? p.evidenceCriteria,
          })) as Property[];
          setProperties(realProps);
          localStorage.setItem("stayhost_properties", JSON.stringify(realProps));
        }
      } catch {
        if (!loadFromLocalStorage()) router.replace("/acceso");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initSession();
    return () => { cancelled = true; };
  }, [router]);

  // Persist task changes back to localStorage
  useEffect(() => {
    if (!loading && tasks.length > 0) {
      localStorage.setItem("stayhost_tasks", JSON.stringify(tasks));
    }
  }, [tasks, loading]);

  // ─── Realtime: re-fetch tasks cuando cambia algo en BD ──────────────────
  // Esto sincroniza al instante (~100ms) los cambios del owner panel:
  //   - asigna una tarea nueva a Sofia → aparece en su app
  //   - cambia el priority/checklist → se refresca solo
  // También captura sus propios cambios (es no-op porque ya están en local).
  useTableSync({
    table: "cleaning_tasks",
    filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined,
    enabled: !!tenantId,
    onChange: async () => {
      try {
        const res = await fetch("/api/cleaning-tasks", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setTasks((data.tasks ?? data ?? []).map(mapApiTask));
      } catch (e) {
        console.warn("[/staff] realtime refetch failed", e);
      }
    },
  });

  // ─── Derived ──────────────────────────────────────────────────────────────
  const myTasks = tasks.filter(t => t.assigneeId === session?.memberId);
  const currentActiveTask = tasks.find(t => t.id === activeTaskId);
  const currentProperty = currentActiveTask
    ? properties.find(p => p.id === currentActiveTask.propertyId)
    : null;
  const activeCriteria =
    currentProperty?.evidenceCriteria?.length
      ? currentProperty.evidenceCriteria
      : ["Cocina", "Habitación", "Baño"];

  const staffSummary = {
    urgent: myTasks.filter(
      t => t.dueDate === getDateStr(0) && parseInt(t.dueTime.split(":")[0]) < 6
    ).length,
    pending: myTasks.filter(t => t.acceptanceStatus === "pending" || t.status === "pending").length,
    today: myTasks.filter(t => t.dueDate === getDateStr(0)).length,
  };

  const filteredTasksByTime = myTasks
    .filter(t => {
      if (staffTimeFilter === "today") return t.dueDate === getDateStr(0);
      if (staffTimeFilter === "tomorrow") return t.dueDate === getDateStr(1);
      return true;
    })
    .sort((a, b) => {
      const aInfo = getPriorityInfo(a);
      const bInfo = getPriorityInfo(b);
      if (aInfo.isUrgent && !bInfo.isUrgent) return -1;
      if (!aInfo.isUrgent && bInfo.isUrgent) return 1;
      return a.dueTime.localeCompare(b.dueTime);
    });

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const toggleAvailable = async () => {
    if (!session) return;
    const next = !available;
    // Optimista: actualiza UI primero, después sincroniza con BD.
    setAvailable(next);
    const updated = { ...session, available: next };
    setSession(updated);
    localStorage.setItem("stayhost_session", JSON.stringify(updated));

    try {
      const res = await fetch(
        `/api/team-members?id=${encodeURIComponent(session.memberId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ available: next }),
        }
      );
      if (!res.ok) {
        // Revertir en error: la BD es la fuente de verdad.
        setAvailable(!next);
        const reverted = { ...session, available: !next };
        setSession(reverted);
        localStorage.setItem("stayhost_session", JSON.stringify(reverted));
      }
    } catch {
      setAvailable(!next);
      const reverted = { ...session, available: !next };
      setSession(reverted);
      localStorage.setItem("stayhost_session", JSON.stringify(reverted));
    }
  };

  const handleLogout = async () => {
    if (session) {
      // Best-effort: registrar último activo en BD. No bloquea logout.
      fetch(`/api/team-members?id=${encodeURIComponent(session.memberId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lastActive: new Date().toISOString() }),
      }).catch(() => {});
    }
    try {
      localStorage.removeItem("stayhost_session");
    } catch {}
    window.location.assign("/salir");
  };

  const toggleChecklistItem = (taskId: string, itemId: string) => {
    let updatedItems: { id: string; label: string; done: boolean; type: "general" | "appliance" }[] | undefined;
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== taskId) return t;
        updatedItems = t.checklistItems?.map(i =>
          i.id === itemId ? { ...i, done: !i.done } : i
        );
        return { ...t, checklistItems: updatedItems };
      })
    );
    if (updatedItems) {
      patchTask(taskId, { checklistItems: updatedItems });
    }
  };

  // Helper: PATCH a /api/cleaning-tasks. Best-effort en errores de red —
  // si falla, el estado local ya está actualizado y el siguiente reload
  // de /api/cleaning-tasks corregirá. No queremos bloquear al staff por
  // un error transient de conexión móvil.
  const patchTask = async (taskId: string, patch: Record<string, unknown>) => {
    try {
      const res = await fetch(
        `/api/cleaning-tasks?id=${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) console.warn("[/staff] patchTask non-ok", res.status);
    } catch (e) {
      console.warn("[/staff] patchTask network error", e);
    }
  };

  const handleAcceptTask = (taskId: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, acceptanceStatus: "accepted", status: "accepted" } : t
      )
    );
    patchTask(taskId, { status: "accepted" });
  };

  const handleDeclineTask = (taskId: string, reason?: string) => {
    const newDeclinedIds = (() => {
      const t = tasks.find(x => x.id === taskId);
      const prev = t?.declinedByIds ?? [];
      return session?.memberId ? [...prev, session.memberId] : prev;
    })();
    setTasks(prev =>
      prev.map(t =>
        t.id !== taskId ? t : {
          ...t,
          declinedByIds: newDeclinedIds,
          rejectionReason: reason,
          acceptanceStatus: "declined",
          status: "rejected",
        }
      )
    );
    patchTask(taskId, {
      status: "rejected",
      declinedByIds: newDeclinedIds,
      rejectionReason: reason ?? null,
    });
  };

  const handleStartCleaning = (taskId: string) => {
    const now = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, status: "in_progress", startTime: now } : t
      )
    );
    setWizardStep(1);
    patchTask(taskId, { status: "in_progress", startTime: now });
  };

  // ─── Loading / guard ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC]">
        <p className="text-slate-400 text-sm font-medium">Cargando portal...</p>
      </div>
    );
  }

  if (!session) return null;

  // ─── SCREEN: HOME ─────────────────────────────────────────────────────────
  if (screen === "home") {
    return (
      <div className="min-h-screen bg-[#F8F9FC] pb-24">
        {/* Header */}
        <div className="bg-white px-6 pt-12 pb-6 shadow-sm sticky top-0 z-20">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar className="h-12 w-12 border-2 border-primary/10">
                  <AvatarFallback className="bg-primary/10 text-primary font-black text-sm">
                    {session.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white",
                    available ? "bg-emerald-500" : "bg-slate-300"
                  )}
                />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-800">{session.name}</h2>
                <p className="text-xs font-bold text-slate-400">
                  {roleLabels[session.role] ?? session.role}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAvailable}
                className={cn(
                  "h-10 px-4 rounded-full text-xs font-bold border transition-all",
                  available
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-slate-50 border-slate-200 text-slate-500"
                )}
              >
                {available ? <><Eye className="h-3.5 w-3.5 inline mr-1.5" />Disponible</> : <><EyeOff className="h-3.5 w-3.5 inline mr-1.5" />Ocupado</>}
              </button>
              <div className="h-10 w-10 flex items-center justify-center bg-primary/5 rounded-full">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div
              className={cn(
                "p-3 rounded-2xl border text-center transition-all",
                staffSummary.urgent > 0
                  ? "bg-rose-50 border-rose-100 ring-1 ring-rose-200"
                  : "bg-slate-50 border-slate-100"
              )}
            >
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Urgentes</p>
              <p className={cn("text-xl font-black", staffSummary.urgent > 0 ? "text-rose-600" : "text-slate-600")}>
                {staffSummary.urgent}
              </p>
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

          {/* Time filter tabs */}
          <div className="flex bg-slate-100 p-1 rounded-2xl">
            {(["today", "tomorrow", "week"] as const).map(f => (
              <button
                key={f}
                onClick={() => setStaffTimeFilter(f)}
                className={cn(
                  "flex-1 py-2.5 text-[10px] uppercase tracking-widest font-black rounded-xl transition-all",
                  staffTimeFilter === f
                    ? "bg-white text-primary shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {f === "today" ? "Hoy" : f === "tomorrow" ? "Mañana" : "Semana"}
              </button>
            ))}
          </div>
        </div>

        {/* Task list */}
        <div className="px-6 mt-6 space-y-3">
          {filteredTasksByTime.length > 0 ? (
            filteredTasksByTime.map(task => {
              const info = getPriorityInfo(task);
              const isMaintenance =
                task.guestName.toLowerCase().includes("mantenimiento") ||
                task.priority === "critical";

              return (
                <div
                  key={task.id}
                  onClick={() => {
                    setActiveTaskId(task.id);
                    setScreen("task");
                  }}
                  className={cn(
                    "relative bg-white rounded-2xl border flex items-stretch overflow-hidden active:scale-[0.98] transition-all cursor-pointer h-20",
                    info.isUrgent ? "border-rose-200 shadow-md shadow-rose-50" : "border-slate-100"
                  )}
                >
                  <div className={cn("w-2", info.borderColor)} />
                  <div className="flex-1 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-100 relative shadow-inner shrink-0">
                        {task.propertyImage ? (
                          <img src={task.propertyImage} className="h-full w-full object-cover" alt="" />
                        ) : (
                          <div className="h-full w-full bg-primary/10 flex items-center justify-center">
                            <Box className="h-5 w-5 text-primary/40" />
                          </div>
                        )}
                        {isMaintenance && (
                          <div className="absolute inset-0 bg-primary/40 flex items-center justify-center">
                            <Wrench className="h-5 w-5 text-white" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-slate-800 text-sm truncate max-w-[140px]">
                            {task.propertyName}
                          </h4>
                          {task.status === "in_progress" && (
                            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge
                            variant="outline"
                            className={cn("text-[9px] h-4 px-1 border-none", info.color)}
                          >
                            {info.label}
                          </Badge>
                          <span className="text-[10px] font-bold text-slate-500">
                            Salida {task.dueTime}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="h-10 w-10 rounded-full flex items-center justify-center shadow-sm border shrink-0 ml-2">
                      {task.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                      )}
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
              <p className="text-slate-400 text-sm font-bold">No hay tareas programadas</p>
            </div>
          )}
        </div>

        {/* Logout FAB */}
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-6 right-6 rounded-full shadow-2xl h-12 px-6 border-slate-200 bg-white"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Cerrar sesión
        </Button>
      </div>
    );
  }

  // Guard: no active task
  if (!currentActiveTask) {
    setScreen("home");
    return null;
  }

  // ─── SCREEN: TASK DETAIL (pending/assigned/accepted/issue) ───────────────
  if (["pending", "assigned", "accepted", "issue"].includes(currentActiveTask.status)) {
    return (
      <StaffTaskDetail
        task={currentActiveTask}
        bedConfiguration={currentProperty?.bedConfiguration}
        ownerWhatsapp={ownerWhatsapp}
        staffName={session?.name}
        onClose={() => setScreen("home")}
        onAccept={handleAcceptTask}
        onDecline={(taskId, reason) => {
          handleDeclineTask(taskId, reason);
          setScreen("home");
        }}
        onStartCleaning={handleStartCleaning}
      />
    );
  }

  // ─── SCREEN: WIZARD (in_progress — steps 1, 2, 3) ────────────────────────
  return (
    <StaffWizard
      task={currentActiveTask as any}
      activeCriteria={activeCriteria}
      ownerWhatsapp={ownerWhatsapp}
      staffName={session?.name}
      onClose={() => setScreen("home")}
      onToggleChecklist={toggleChecklistItem}
      onSubmit={(taskId, photos, notes, issues) => {
        setTasks(prev =>
          prev.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  status: "completed",
                  isWaitingValidation: true,
                  // No pisamos closure_photos: las fotos ya están persistidas
                  // en BD por el endpoint POST /photos. El state local sigue
                  // con las URLs firmadas que se vencen en 1h — pero como el
                  // GET de cleaning-tasks revuelve a recargar, no es un
                  // problema (CleaningPanel pide signed URLs frescas vía el
                  // endpoint GET /photos).
                  incidentReport: notes,
                  reportedIssues: issues.map(i => i.title),
                }
              : t
          )
        );
        // Persistir el cierre en BD: sin esto, el supervisor nunca ve la
        // tarea en su cola "A validar". El bug previo era que el handler
        // sólo tocaba el state local del cleaner.
        fetch(`/api/cleaning-tasks?id=${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            status: "completed",
            isWaitingValidation: true,
            reportedIssues: issues.map(i => i.title),
          }),
        }).catch((e) => console.warn("[/staff] cleanup PATCH failed", e));
        // Crear tickets de mantenimiento en background. No bloquea el cierre
        // de la tarea — si la red falla, el limpiador puede volver a reportar
        // desde el panel admin. El `propertyId` viene del CleaningTask.
        const task = tasks.find(t => t.id === taskId);
        if (task && issues.length) {
          const propertyId = (task as unknown as { propertyId: string }).propertyId;
          issues.forEach(i => {
            fetch("/api/maintenance-tickets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                propertyId,
                cleaningTaskId: taskId,
                reportedById: session?.memberId ?? null,
                reportedByName: session?.name ?? null,
                title: i.title,
                description: i.description || null,
                category: i.category,
                severity: i.severity,
                photos: i.photos,
              }),
            }).catch(() => {/* silencioso: no bloqueamos al limpiador */});
          });
        }
        setScreen("home");
        setActiveTaskId(null);
        setWizardStep(1);
        setTempPhotos([]);
      }}
    />
  );
}
