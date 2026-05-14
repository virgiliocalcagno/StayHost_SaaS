"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { logoutAndRedirect } from "@/lib/auth/logout";
import { useTableSync } from "@/lib/realtime/useTableSync";
import {
  CheckCircle2,
  AlertCircle,
  ClipboardCheck,
  ListChecks,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Camera,
  Clock,
  ImageOff,
  RotateCcw,
  Phone,
  Circle,
  Sparkles,
  UserCog,
  X,
} from "lucide-react";

type Tab = "inbox" | "tasks" | "team";

interface SupervisorTeamMember {
  id: string;
  name: string;
  phone: string;
  avatar: string | null;
  role: string;
  status: string;
  available: boolean;
  lastActive: string | null;
}

interface SupervisorTask {
  taskId: string;
  propertyId: string | null;
  propertyName: string;
  propertyImage: string | null;
  dueDate: string;
  dueTime: string | null;
  startTime: string | null;
  status: string;
  isWaitingValidation: boolean;
  validatedAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: string | null;
}

interface ValidationTask {
  taskId: string;
  propertyId: string | null;
  propertyName: string;
  propertyImage: string | null;
  evidenceCriteria: string[];
  dueDate: string;
  dueTime: string | null;
  startTime: string | null;
  assigneeName: string;
  closurePhotos: { category: string; url: string }[];
  reportedIssues: string[];
  previousRejection: string | null;
}

function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" });
}

export default function SupervisorPage() {
  // Home del supervisor = "Tareas" (cronograma operativo). Inbox de
  // aprobaciones es secundario — solo se llena cuando un cleaner termina.
  const [tab, setTab] = useState<Tab>("tasks");
  const [validations, setValidations] = useState<ValidationTask[] | null>(null);
  const [tasks, setTasks] = useState<SupervisorTask[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<SupervisorTeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ValidationTask | null>(null);
  const [reassigning, setReassigning] = useState<SupervisorTask | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [myTasksCount, setMyTasksCount] = useState<number>(0);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);

  // Tenant + memberId: tenant para Realtime; memberId para contar tareas
  // propias (Helen como assignee — su panel "Mis limpiezas").
  useEffect(() => {
    fetch("/api/me", { cache: "no-store", credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((me: { tenantId: string | null; memberId: string | null } | null) => {
        if (me?.tenantId) setTenantId(me.tenantId);
        if (me?.memberId) setMemberId(me.memberId);
      })
      .catch(() => {});
  }, []);

  const loadValidations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/supervisor/pending-validations", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      const data = (await r.json()) as { validations: ValidationTask[] };
      setValidations(data.validations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/supervisor/tasks", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      const data = (await r.json()) as { tasks: SupervisorTask[] };
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/supervisor/team", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      const data = (await r.json()) as { members: SupervisorTeamMember[] };
      setTeamMembers(data.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch ligero del contador de "Por aprobar" — corre cuando NO estamos
  // en inbox, para mantener fresco el badge del bottom nav. Cuando estamos
  // en inbox, validations.length ya manda.
  const refreshPendingCount = useCallback(async () => {
    try {
      const r = await fetch("/api/supervisor/pending-validations", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { validations: ValidationTask[] };
      setPendingCount(data.validations?.length ?? 0);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (tab === "inbox") loadValidations();
    else if (tab === "tasks") loadTasks();
    else if (tab === "team") loadTeam();
    // El badge del nav siempre refleja la cola, aunque no estés en inbox.
    if (tab !== "inbox") refreshPendingCount();
  }, [tab, loadValidations, loadTasks, loadTeam, refreshPendingCount]);

  // Sincroniza inbox count con la lista cuando estamos en inbox.
  useEffect(() => {
    if (tab === "inbox" && validations) setPendingCount(validations.length);
  }, [tab, validations]);

  // Conteo de "Mis limpiezas" — tareas activas donde el supervisor es
  // assignee. Solo cuenta no-completadas y no-aprobadas (lo pendiente).
  useEffect(() => {
    if (!memberId || !tasks) {
      setMyTasksCount(0);
      return;
    }
    const mine = tasks.filter(
      t =>
        t.assigneeId === memberId &&
        t.validatedAt === null &&
        t.status !== "completed",
    );
    setMyTasksCount(mine.length);
  }, [tasks, memberId]);

  // Auto-refresh:
  //   - cuando la pestaña vuelve a estar visible (volver del fondo en mobile)
  //   - polling suave cada 60s mientras la app esté activa
  // Sin esto el supervisor ve estado stale después de minutos sin tocar.
  useEffect(() => {
    const reload = () => {
      if (document.hidden) return;
      if (tab === "inbox") loadValidations();
      else if (tab === "tasks") {
        loadTasks();
        refreshPendingCount();
      } else if (tab === "team") {
        loadTeam();
        refreshPendingCount();
      }
    };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("focus", reload);
    const interval = window.setInterval(reload, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("focus", reload);
      window.clearInterval(interval);
    };
  }, [tab, loadValidations, loadTasks, loadTeam, refreshPendingCount]);

  // Realtime: cuando cambia cualquier cleaning_task del tenant, refrescamos
  // el tab activo y el badge "Por aprobar". Esto cubre asignaciones nuevas,
  // cambios de status y subidas de fotos sin esperar el polling de 60s.
  useTableSync({
    table: "cleaning_tasks",
    filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined,
    enabled: !!tenantId,
    onChange: () => {
      if (tab === "inbox") loadValidations();
      else if (tab === "tasks") {
        loadTasks();
        refreshPendingCount();
      } else {
        refreshPendingCount();
      }
    },
  });

  if (reviewing) {
    return (
      <ReviewScreen
        task={reviewing}
        onClose={() => setReviewing(null)}
        onResolved={() => {
          setReviewing(null);
          loadValidations();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] pb-28">
      <header className="w-full bg-white px-6 pt-12 pb-6 border-b border-slate-200 sticky top-0 z-40">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {tab === "inbox" && "Por aprobar"}
          {tab === "tasks" && "Tareas del equipo"}
          {tab === "team" && "Mi equipo"}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {tab === "inbox" && "Revisá la evidencia y aprobá o pedí re-foto."}
          {tab === "tasks" && "Cronograma de las propiedades que coordinás."}
          {tab === "team" && "Tu gente en vivo."}
        </p>
      </header>

      <main className="max-w-xl mx-auto px-6 py-6">
        {tab === "inbox" && (
          <InboxTab
            loading={loading}
            error={error}
            validations={validations}
            onPickTask={setReviewing}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            loading={loading}
            error={error}
            tasks={tasks}
            onReassign={setReassigning}
          />
        )}
        {tab === "team" && (
          <TeamTab loading={loading} error={error} members={teamMembers} />
        )}
      </main>

      {/* Bottom nav — orden: Tareas (home), Mis limpiezas, Por aprobar, Equipo, Salir */}
      <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-slate-200 px-2 pt-3 pb-6 z-40 flex justify-around items-center shadow-[0_-1px_10px_rgba(0,0,0,0.04)]">
        <NavButton
          active={tab === "tasks"}
          icon={<ListChecks className="h-6 w-6" strokeWidth={2.2} />}
          label="Tareas"
          onClick={() => setTab("tasks")}
        />
        <NavButton
          icon={<Sparkles className="h-6 w-6" strokeWidth={2.2} />}
          label="Mis limpiezas"
          badge={myTasksCount}
          onClick={() => {
            window.location.href = "/staff?from=supervisor";
          }}
        />
        <NavButton
          active={tab === "inbox"}
          icon={<ClipboardCheck className="h-6 w-6" strokeWidth={2.2} />}
          label="Por aprobar"
          badge={pendingCount}
          onClick={() => setTab("inbox")}
        />
        <NavButton
          active={tab === "team"}
          icon={<Users className="h-6 w-6" strokeWidth={2.2} />}
          label="Equipo"
          onClick={() => setTab("team")}
        />
        <NavButton
          icon={<LogOut className="h-6 w-6 text-slate-400" strokeWidth={2.2} />}
          label="Salir"
          danger
          onClick={() => logoutAndRedirect()}
        />
      </nav>

      {reassigning && (
        <ReassignDialog
          task={reassigning}
          onClose={() => setReassigning(null)}
          onDone={() => {
            setReassigning(null);
            loadTasks();
            refreshPendingCount();
          }}
        />
      )}
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  badge,
  danger,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 px-2 group relative">
      <div
        className={cn(
          "transition-colors",
          active ? "text-primary" : danger ? "text-slate-400 group-hover:text-rose-600" : "text-slate-400 group-hover:text-slate-700",
        )}
      >
        {icon}
        {!!badge && badge > 0 && (
          <span className="absolute -top-1 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
      <span
        className={cn(
          "text-[11px]",
          active ? "font-bold text-slate-900" : danger ? "font-medium text-slate-500 group-hover:text-rose-600" : "font-medium text-slate-500 group-hover:text-slate-700",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function InboxTab({
  loading,
  error,
  validations,
  onPickTask,
}: {
  loading: boolean;
  error: string | null;
  validations: ValidationTask[] | null;
  onPickTask: (t: ValidationTask) => void;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-rose-800 text-sm">No pudimos cargar la cola</p>
          <p className="text-rose-700 text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }
  if (!validations || validations.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-32 h-32 mb-6 relative">
          <div className="absolute inset-0 bg-emerald-50 rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" strokeWidth={1.5} />
          </div>
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Cola vacía</h3>
        <p className="text-slate-500 text-sm max-w-[280px]">
          No hay limpiezas esperando aprobación. Buen trabajo del equipo.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {validations.map(v => (
        <button
          key={v.taskId}
          onClick={() => onPickTask(v)}
          className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex items-center text-left active:scale-[0.99] transition-all hover:border-slate-300"
        >
          <div className="w-2 self-stretch bg-amber-400" />
          <div className="flex-1 p-4 flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-100 shrink-0">
              {v.propertyImage ? (
                <img src={v.propertyImage} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-primary/10">
                  <ImageOff className="h-5 w-5 text-primary/40" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 truncate">{v.propertyName}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {v.assigneeName} · {formatDay(v.dueDate)}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <Camera className="h-3 w-3" />
                  {v.closurePhotos.length} fotos
                </span>
                {v.previousRejection && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                    <RotateCcw className="h-3 w-3" />
                    re-envío
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
          </div>
        </button>
      ))}
    </div>
  );
}

function TasksTab({
  loading,
  error,
  tasks,
  onReassign,
}: {
  loading: boolean;
  error: string | null;
  tasks: SupervisorTask[] | null;
  onReassign: (task: SupervisorTask) => void;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-rose-800 text-sm">No pudimos cargar las tareas</p>
          <p className="text-rose-700 text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }
  if (!tasks || tasks.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-32 h-32 mb-6 bg-slate-100 rounded-full flex items-center justify-center">
          <ListChecks className="h-12 w-12 text-slate-400" strokeWidth={1.5} />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Sin tareas próximas</h3>
        <p className="text-slate-500 text-sm max-w-[280px]">
          Cuando se programen limpiezas en tus propiedades aparecerán aquí.
        </p>
      </section>
    );
  }

  // Agrupar por día
  const byDay = new Map<string, SupervisorTask[]>();
  for (const t of tasks) {
    if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []);
    byDay.get(t.dueDate)!.push(t);
  }

  return (
    <div className="space-y-6">
      {Array.from(byDay.entries()).map(([day, group]) => (
        <div key={day}>
          <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2 px-1">
            {formatDay(day)}
          </p>
          <div className="space-y-2">
            {group.map(t => {
              const canReassign = !t.validatedAt;
              return (
                <div
                  key={t.taskId}
                  className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3"
                >
                  <div className="h-10 w-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                    {t.propertyImage ? (
                      <img src={t.propertyImage} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-primary/10">
                        <ImageOff className="h-4 w-4 text-primary/40" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">{t.propertyName}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t.assigneeName ?? "Sin asignar"} · {t.dueTime ?? "—"}
                    </p>
                  </div>
                  <TaskStatusBadge task={t} />
                  {canReassign && (
                    <button
                      onClick={() => onReassign(t)}
                      className="h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 shrink-0"
                      title="Reasignar"
                      aria-label="Reasignar tarea"
                    >
                      <UserCog className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReassignDialog({
  task,
  onClose,
  onDone,
}: {
  task: SupervisorTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const [members, setMembers] = useState<SupervisorTeamMember[] | null>(null);
  const [picked, setPicked] = useState<string | "unassign" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/supervisor/team", { credentials: "same-origin", cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { members: SupervisorTeamMember[] } | null) => {
        if (d) setMembers(d.members);
      })
      .catch(() => setErr("No se pudo cargar el equipo"));
  }, []);

  const submit = async () => {
    if (!picked) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch("/api/supervisor/reassign-task", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.taskId,
          newAssigneeId: picked === "unassign" ? null : picked,
        }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al reasignar");
    } finally {
      setSubmitting(false);
    }
  };

  // El miembro actualmente asignado se muestra deshabilitado (ya está en él).
  const currentAssigneeId = task.assigneeId;
  const candidates = (members ?? []).filter(m => m.id !== currentAssigneeId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-slate-200 flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Reasignar tarea</h3>
            <p className="text-xs text-slate-500 mt-1 truncate">
              {task.propertyName} · {task.dueTime ?? formatDay(task.dueDate)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Actualmente: {task.assigneeName ?? "Sin asignar"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {!members && (
            <p className="text-center text-slate-400 text-sm py-8">Cargando equipo…</p>
          )}
          {members && candidates.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8 px-4">
              No tenés a quién reasignar. Pedile al admin que sume gente a tu equipo.
            </p>
          )}
          {candidates.map(m => {
            const isPicked = picked === m.id;
            const initials = m.name
              .split(" ")
              .map(w => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <button
                key={m.id}
                onClick={() => setPicked(m.id)}
                disabled={!m.available}
                className={cn(
                  "w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-colors text-left",
                  !m.available && "opacity-40 cursor-not-allowed",
                  isPicked
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
                  {initials || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{m.name}</p>
                  <p className="text-[11px] text-slate-500 capitalize">
                    {m.role} · {m.available ? "Disponible" : "No disponible"}
                  </p>
                </div>
                {isPicked && <CheckCircle2 className="h-5 w-5 text-blue-500 shrink-0" />}
              </button>
            );
          })}
          {/* Desasignar (dejar la tarea libre) */}
          {currentAssigneeId && (
            <button
              onClick={() => setPicked("unassign")}
              className={cn(
                "w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-colors text-left",
                picked === "unassign"
                  ? "border-rose-500 bg-rose-50"
                  : "border-dashed border-slate-300 hover:border-rose-300",
              )}
            >
              <div className="h-10 w-10 rounded-full bg-rose-100 text-rose-600 font-bold flex items-center justify-center text-sm">
                <X className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">Dejar sin asignar</p>
                <p className="text-[11px] text-slate-500">Quedará libre para tomar</p>
              </div>
              {picked === "unassign" && <CheckCircle2 className="h-5 w-5 text-rose-500 shrink-0" />}
            </button>
          )}
        </div>

        {err && (
          <div className="px-5 py-2 bg-rose-50 border-t border-rose-200 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="text-sm font-semibold text-slate-600 hover:text-slate-800"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!picked || submitting}
            className="px-5 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-bold flex items-center gap-2"
          >
            {submitting ? "Reasignando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskStatusBadge({ task }: { task: SupervisorTask }) {
  if (task.validatedAt) {
    return (
      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
        Aprobada
      </span>
    );
  }
  if (task.isWaitingValidation) {
    return (
      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
        Esperando
      </span>
    );
  }
  if (task.status === "in_progress") {
    return (
      <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
        En curso
      </span>
    );
  }
  if (task.priority === "critical") {
    return (
      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
        Crítica
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
      Pendiente
    </span>
  );
}

function TeamTab({
  loading,
  error,
  members,
}: {
  loading: boolean;
  error: string | null;
  members: SupervisorTeamMember[] | null;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-rose-800 text-sm">No pudimos cargar el equipo</p>
          <p className="text-rose-700 text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }
  if (!members || members.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-32 h-32 mb-6 bg-slate-100 rounded-full flex items-center justify-center">
          <Users className="h-12 w-12 text-slate-400" strokeWidth={1.5} />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Sin equipo asignado</h3>
        <p className="text-slate-500 text-sm max-w-[280px]">
          Pedile al admin que te asigne operarios desde el panel de Equipo.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-2">
      {members.map(m => {
        const initials = m.name
          .split(" ")
          .map(w => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        const cleanPhone = m.phone.replace(/\D/g, "");
        const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
        return (
          <div
            key={m.id}
            className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
                {m.avatar ? (
                  <img src={m.avatar} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  initials || "?"
                )}
              </div>
              <Circle
                className={cn(
                  "h-3 w-3 absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white fill-current",
                  m.available ? "text-emerald-500" : "text-slate-300",
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 truncate">{m.name}</p>
              <p className="text-[11px] text-slate-500 truncate capitalize">
                {m.role} · {m.available ? "Disponible" : "No disponible"}
              </p>
            </div>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center shrink-0"
                aria-label={`WhatsApp ${m.name}`}
              >
                <Phone className="h-4 w-4" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewScreen({
  task,
  onClose,
  onResolved,
}: {
  task: ValidationTask;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const photos = task.closurePhotos;
  const currentPhoto = photos[photoIdx] ?? null;

  const submit = async (approved: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/cleaning-tasks/${task.taskId}/validate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          approved
            ? { approved: true }
            : { approved: false, rejectionNote: rejectionNote.trim() },
        ),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 flex items-center gap-3 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur-sm z-30">
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{task.propertyName}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {task.assigneeName} · {formatDay(task.dueDate)}
          </p>
        </div>
      </header>

      {/* Foto fullscreen + swipe */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
        {currentPhoto ? (
          <>
            <img
              src={currentPhoto.url}
              alt={currentPhoto.category}
              className="max-w-full max-h-[60vh] rounded-xl shadow-2xl object-contain"
            />
            <p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-400">
              {currentPhoto.category}
            </p>
            <p className="text-[11px] text-slate-500">
              {photoIdx + 1} de {photos.length}
            </p>
            {photos.length > 1 && (
              <>
                <button
                  onClick={() => setPhotoIdx(i => (i === 0 ? photos.length - 1 : i - 1))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={() => setPhotoIdx(i => (i === photos.length - 1 ? 0 : i + 1))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </>
        ) : (
          <div className="text-center">
            <ImageOff className="h-16 w-16 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">El cleaner no subió fotos.</p>
          </div>
        )}
      </div>

      {/* Issues reportados + criterios esperados */}
      {(task.reportedIssues.length > 0 || task.evidenceCriteria.length > 0) && (
        <div className="px-4 py-3 border-t border-slate-800 bg-slate-950 space-y-2">
          {task.reportedIssues.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-amber-400 mb-1">
                Reportes del cleaner
              </p>
              <div className="flex flex-wrap gap-1.5">
                {task.reportedIssues.map((iss, i) => (
                  <span key={i} className="text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-200 px-2 py-0.5 rounded-full">
                    {iss}
                  </span>
                ))}
              </div>
            </div>
          )}
          {task.evidenceCriteria.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">
                Criterios esperados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {task.evidenceCriteria.map((c, i) => {
                  const covered = photos.some(p => p.category === c);
                  return (
                    <span
                      key={i}
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border",
                        covered
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                          : "bg-rose-500/10 border-rose-500/30 text-rose-300",
                      )}
                    >
                      {covered ? "✓" : "✗"} {c}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form de rechazo */}
      {showRejectForm && (
        <div className="px-4 py-4 border-t border-slate-800 bg-slate-950 space-y-2">
          <label className="block text-[11px] uppercase tracking-wider font-bold text-slate-400">
            ¿Qué falta o qué hay que rehacer?
          </label>
          <textarea
            autoFocus
            value={rejectionNote}
            onChange={e => setRejectionNote(e.target.value)}
            rows={3}
            placeholder="Ej: la foto del baño está borrosa, no se ve el inodoro."
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
          />
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-rose-900/40 text-rose-200 text-xs flex items-center gap-2 border-t border-rose-800">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Botones acción */}
      <div className="px-4 py-4 border-t border-slate-800 bg-slate-900 flex gap-3">
        {!showRejectForm ? (
          <>
            <button
              disabled={submitting}
              onClick={() => setShowRejectForm(true)}
              className="flex-1 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 border border-slate-700"
            >
              <RotateCcw className="h-5 w-5" />
              Pedir re-foto
            </button>
            <button
              disabled={submitting}
              onClick={() => submit(true)}
              className="flex-1 h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-5 w-5" />
              Aprobar
            </button>
          </>
        ) : (
          <>
            <button
              disabled={submitting}
              onClick={() => {
                setShowRejectForm(false);
                setRejectionNote("");
              }}
              className="flex-1 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold"
            >
              Cancelar
            </button>
            <button
              disabled={submitting || rejectionNote.trim().length < 5}
              onClick={() => submit(false)}
              className="flex-1 h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold"
            >
              {submitting ? "Enviando…" : "Pedir re-foto"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
