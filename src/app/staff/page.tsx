"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { logoutAndRedirect } from "@/lib/auth/logout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Wrench,
  Camera,
  ClipboardList,
  Check,
  Tv,
  Archive,
  Wind,
  Box,
  LogOut,
  FileText,
  Bed,
  Eye,
  EyeOff,
  ImageIcon,
  X,
} from "lucide-react";
interface StaffSession {
  memberId: string;
  name: string;
  role: string;
  available: boolean;
}

import { StaffWizard } from "@/components/staff-ui/StaffWizard";
import { StaffTaskDetail } from "@/components/staff-ui/StaffTaskDetail";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CleaningTask {
  id: string;
  propertyId: string;
  propertyName: string;
  address: string;
  propertyImage?: string;
  assigneeId?: string;
  assigneeName?: string;
  dueDate: string;
  dueTime: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "issue"
    | "unassigned"
    | "assigned"
    | "accepted"
    | "rejected";
  priority: "low" | "medium" | "high" | "critical";
  isBackToBack: boolean;
  isVacant?: boolean;
  guestName: string;
  guestCount?: number;
  stayDuration?: number;
  acceptanceStatus?: "pending" | "accepted" | "declined";
  declinedByIds?: string[];
  rejectionReason?: string;
  standardInstructions?: string;
  incidentReport?: string;
  checklistItems?: { id: string; label: string; done: boolean; type: "general" | "appliance" }[];
  closurePhotos?: { category: string; url: string }[];
  isWaitingValidation?: boolean;
  startTime?: string;
}

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

const getPriorityInfo = (task: CleaningTask) => {
  const isToday = task.dueDate === getDateStr(0);
  const isTomorrow = task.dueDate === getDateStr(1);
  const [hoursStr] = task.dueTime.split(":");
  const hours = parseInt(hoursStr);

  if ((isToday && hours < 6) || task.priority === "critical") {
    return {
      label: "¡URGENTE!",
      color: "text-white bg-rose-600 border-none animate-pulse",
      isUrgent: true,
      borderColor: "bg-rose-600",
    };
  }
  if (isToday) {
    return {
      label: "PRIORIDAD ALTA",
      color: "text-rose-600 bg-rose-50 border-rose-200",
      isUrgent: false,
      borderColor: "bg-rose-400",
    };
  }
  if (isTomorrow) {
    return {
      label: "PRIORIDAD MEDIA",
      color: "text-amber-600 bg-amber-50 border-amber-200",
      isUrgent: false,
      borderColor: "bg-amber-400",
    };
  }
  return {
    label: "BAJA",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    isUrgent: false,
    borderColor: "bg-emerald-400",
  };
};

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
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
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
        // 1. Check Supabase auth session via /api/me
        const meRes = await fetch("/api/me");
        if (!meRes.ok) throw new Error("api/me failed");
        const me = await meRes.json();

        if (cancelled) return;

        if (!me.email || !me.tenantId) {
          if (!loadFromLocalStorage()) router.replace("/acceso");
          return;
        }

        // 2. Fetch team member for authenticated user
        const tmRes = await fetch("/api/team-members");
        const members = tmRes.ok ? ((await tmRes.json()).members ?? []) : [];
        if (cancelled) return;

        const myMember = members.find(
          (m: { email: string }) => m.email.trim().toLowerCase() === me.email.trim().toLowerCase()
        );

        const sess: StaffSession = {
          memberId: myMember?.id ?? me.tenantId,
          name: myMember?.name ?? me.email.split("@")[0],
          role: myMember?.role ?? (me.isMaster ? "owner" : "cleaner"),
          available: myMember?.available ?? true,
        };

        localStorage.setItem("stayhost_session", JSON.stringify(sess));
        setSession(sess);
        setAvailable(sess.available);

        // 3. Fetch real tasks from backend
        const tasksRes = await fetch("/api/cleaning-tasks");
        if (tasksRes.ok && !cancelled) {
          const tasksData = await tasksRes.json();
          const realTasks = (tasksData.tasks ?? tasksData ?? []).map((t: Record<string, unknown>) => ({
            id: t.id,
            propertyId: t.property_id ?? t.propertyId ?? "",
            propertyName: t.property_name ?? t.propertyName ?? "Propiedad",
            address: t.address ?? "",
            propertyImage: t.property_image ?? t.propertyImage,
            assigneeId: t.assignee_id ?? t.assigneeId,
            assigneeName: t.assignee_name ?? t.assigneeName,
            dueDate: t.due_date ?? t.dueDate ?? "",
            dueTime: t.due_time ?? t.dueTime ?? "12:00",
            status: t.status ?? "pending",
            priority: t.priority ?? "medium",
            isBackToBack: t.is_back_to_back ?? t.isBackToBack ?? false,
            isVacant: t.is_vacant ?? t.isVacant,
            guestName: t.guest_name ?? t.guestName ?? "",
            guestCount: t.guest_count ?? t.guestCount,
            stayDuration: t.stay_duration ?? t.stayDuration,
            checklistItems: t.checklist_items ?? t.checklistItems ?? [],
            closurePhotos: t.closure_photos ?? t.closurePhotos ?? [],
            isWaitingValidation: t.is_waiting_validation ?? t.isWaitingValidation ?? false,
            startTime: t.start_time ?? t.startTime,
            declinedByIds: t.declined_by_ids ?? t.declinedByIds ?? [],
            rejectionReason: t.rejection_reason ?? t.rejectionReason,
            acceptanceStatus: t.acceptance_status ?? t.acceptanceStatus ?? "pending",
          })) as CleaningTask[];
          setTasks(realTasks);
          localStorage.setItem("stayhost_tasks", JSON.stringify(realTasks));
        }

        // 4. Fetch properties
        const propsRes = await fetch("/api/bookings");
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
  const toggleAvailable = () => {
    if (!session) return;
    const next = !available;
    setAvailable(next);
    try {
      const rawTeam = localStorage.getItem("stayhost_team");
      if (rawTeam) {
        const team = JSON.parse(rawTeam);
        localStorage.setItem(
          "stayhost_team",
          JSON.stringify(team.map((m: { id: string }) =>
            m.id === session.memberId ? { ...m, available: next } : m
          ))
        );
      }
      const updated = { ...session, available: next };
      localStorage.setItem("stayhost_session", JSON.stringify(updated));
      setSession(updated);
    } catch {}
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem("stayhost_session");
      const rawTeam = localStorage.getItem("stayhost_team");
      if (rawTeam && session) {
        const team = JSON.parse(rawTeam);
        const time = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        localStorage.setItem(
          "stayhost_team",
          JSON.stringify(team.map((m: { id: string }) =>
            m.id === session.memberId
              ? { ...m, lastActive: `Última vez: ${time}` }
              : m
          ))
        );
      }
    } catch {}
    window.location.assign("/salir");
  };

  const toggleChecklistItem = (taskId: string, itemId: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id !== taskId ? t : {
          ...t,
          checklistItems: t.checklistItems?.map(i =>
            i.id === itemId ? { ...i, done: !i.done } : i
          ),
        }
      )
    );
  };

  const handleAcceptTask = (taskId: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, acceptanceStatus: "accepted", status: "accepted" } : t
      )
    );
  };

  const handleDeclineTask = (taskId: string, reason?: string) => {
    setTasks(prev =>
      prev.map(t =>
        t.id !== taskId ? t : {
          ...t,
          declinedByIds: [...(t.declinedByIds ?? []), ...(session?.memberId ? [session.memberId] : [])],
          rejectionReason: reason,
          acceptanceStatus: "declined",
          status: "rejected",
        }
      )
    );
  };

  const handleStartCleaning = (taskId: string) => {
    const now = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, status: "in_progress", startTime: now } : t
      )
    );
    setWizardStep(1);
  };

  const handleUploadPhoto = (category: string) => {
    const mockUrl = `https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=400&fit=crop&q=60`;
    setTempPhotos(prev => [...prev.filter(p => p.category !== category), { category, url: mockUrl }]);
  };

  const handleSubmitTask = () => {
    if (!activeTaskId) return;
    setTasks(prev =>
      prev.map(t =>
        t.id === activeTaskId
          ? { ...t, status: "completed", isWaitingValidation: true, closurePhotos: tempPhotos }
          : t
      )
    );
    setScreen("home");
    setActiveTaskId(null);
    setWizardStep(1);
    setTempPhotos([]);
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
        task={currentActiveTask as any}
        bedConfiguration={currentProperty?.bedConfiguration}
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
                  closurePhotos: photos,
                  incidentReport: notes,
                  reportedIssues: issues.map(i => i.title),
                }
              : t
          )
        );
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
