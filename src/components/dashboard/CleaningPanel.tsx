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
  const [view, setView] = useState<"day" | "week">("day");
  const [tasks, setTasks] = useState<CleaningTask[]>([]);

  const loadTasks = () => {
    // Tenant is resolved server-side from the session cookie.
    fetch("/api/cleaning-tasks", { credentials: "same-origin" })
      .then(r => r.json())
      .then(data => { if (data.tasks?.length) setTasks(data.tasks); })
      .catch(() => {});
  };

  useEffect(() => { loadTasks(); }, []);

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
    image?: string;
    autoAssignCleaner?: boolean;
    cleanerPriorities?: string[];
    bedConfiguration?: string;
    standardInstructions?: string;
    evidenceCriteria?: string[];
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

  const stats = useMemo(() => ({
    total: tasks.filter(t => t.dueDate === getDateStr(0)).length,
    completed: tasks.filter(t => t.dueDate === getDateStr(0) && t.status === "completed").length,
    pending: tasks.filter(t => t.dueDate === getDateStr(0) && t.status !== "completed").length,
    critical: tasks.filter(t => t.dueDate === getDateStr(0) && t.priority === "critical").length,
  }), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    // Si estamos en vista semana, filtramos por la fecha seleccionada en las pestañas
    if (view === "week") {
      result = result.filter(t => t.dueDate === activeDate);
    } else if (view === "day") {
      result = result.filter(t => t.dueDate === getDateStr(0));
    }

    if (selectedStaff !== "all") {
      result = result.filter(t => t.assigneeId === selectedStaff);
    }

    return result.sort((a, b) => {
      // Vacantes al final (baja prioridad), críticos al frente
      if (a.isVacant && !b.isVacant) return 1;
      if (!a.isVacant && b.isVacant) return -1;
      return a.priority === "critical" ? -1 : 1;
    });
  }, [tasks, view, selectedStaff, activeDate]);

  // ─── Linen Summary (ropa de cama necesaria hoy) ───────────────────────────
  const linenSummary = useMemo(() => {
    const targetTasks = tasks.filter(t => t.dueDate === activeDate);
    const beds: Record<string, number> = {};
    let totalTowels = 0;

    targetTasks.forEach(t => {
      const prop = properties.find(p => p.id === t.propertyId);
      if (!prop?.bedConfiguration) return;
      
      // Calculate towels (2 per guest)
      totalTowels += (t.guestCount || 2) * 2;

      // Parse bed configuration
      prop.bedConfiguration.split(",").forEach(part => {
        const match = part.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
          const qty = parseInt(match[1]);
          const type = match[2].trim();
          beds[type] = (beds[type] || 0) + qty;
        }
      });
    });

    return {
      beds: Object.entries(beds).map(([type, qty]) => ({ type, qty })),
      towels: totalTowels
    };
  }, [tasks, properties]);

  const getStatusBadge = (task: CleaningTask) => {
    if (task.status === "completed") {
      return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white border-0">Completado</Badge>;
    }
    if (task.status === "in_progress") {
      return (
        <div className="flex flex-col items-end gap-1">
          <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground border-0 italic animate-pulse">En curso</Badge>
          {task.startTime && <span className="text-[10px] font-bold text-primary">Inició {task.startTime}</span>}
        </div>
      );
    }
    if (task.status === "issue") {
      return <Badge variant="destructive">Incidencia</Badge>;
    }
    if (task.status === "unassigned") {
      return <Badge className="bg-amber-100 text-amber-700 border-amber-300 animate-pulse">Sin asignar</Badge>;
    }
    if (task.status === "assigned") {
      return <Badge className="bg-blue-50 text-blue-700 border-blue-200">Asignado</Badge>;
    }
    if (task.status === "accepted") {
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Aceptado ✓</Badge>;
    }
    if (task.status === "rejected") {
      return (
        <div className="flex flex-col items-end gap-1">
          <Badge className="bg-rose-100 text-rose-700 border-rose-300">Rechazado</Badge>
          {task.rejectionReason && (
            <span className="text-[10px] text-rose-500 max-w-[140px] text-right leading-tight">"{task.rejectionReason}"</span>
          )}
        </div>
      );
    }
    // Fallback: legacy pending — check acceptanceStatus
    if (task.acceptanceStatus === "accepted") {
      return <Badge variant="outline" className="border-emerald-200 text-emerald-600 bg-emerald-50">Aceptado</Badge>;
    }
    if (task.acceptanceStatus === "declined") {
      return <Badge variant="outline" className="border-rose-200 text-rose-600 bg-rose-50">Rechazado</Badge>;
    }
    return <Badge variant="secondary" className="bg-muted text-muted-foreground border-0">Pendiente</Badge>;
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

  const handleSendMessage = (phone: string, property: string, taskId: string) => {
    const link = `${window.location.origin}/dashboard?view=staff&task=${taskId}`;
    const msg = encodeURIComponent(`Hola, tienes una limpieza en ${property}. ✨\nAccede aquí para ver detalles y reportar: ${link}`);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
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
          <Tabs value={view} onValueChange={(v) => setView(v as "day" | "week")} className="w-auto">
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="day" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-4">Diaria</TabsTrigger>
              <TabsTrigger value="week" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-4">Semanal</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => setShowAddTask(true)} className="gradient-gold text-primary-foreground shadow-lg hover:shadow-primary/20 transition-all gap-2 px-6">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva Orden</span>
          </Button>
        </div>
      </div>

      {/* ─── Top Dashboard Stats ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Checkouts Hoy", value: stats.total, icon: LogOut, color: "text-primary", bg: "bg-primary/10" },
          { label: "Back-to-Back", value: stats.critical, icon: TrendingUp, color: "text-rose-600", bg: "bg-rose-100/50" },
          { label: "Completadas", value: stats.completed, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100/50" },
          { label: "Pendientes", value: stats.pending, icon: Clock, color: "text-muted-foreground", bg: "bg-muted" },
        ].map((stat, i) => (
          <Card key={i} className="border-none shadow-soft overflow-hidden group">
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

      {/* ─── Linen & Workday Summary ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-soft bg-white rounded-[2rem] overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                Logística de Lencería para Hoy
              </CardTitle>
              <Badge variant="outline" className="border-primary/20 text-primary font-bold">
                {stats.total} Propiedades
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {linenSummary.beds.map((item, idx) => (
                <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 group hover:border-primary/20 transition-all">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-primary transition-colors">Sábanas {item.type}</p>
                  <p className="text-2xl font-black text-slate-800">{item.qty} sets</p>
                </div>
              ))}
              <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10">
                <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">Total Toallas</p>
                <p className="text-2xl font-black text-primary">{linenSummary.towels} unidades</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-soft bg-slate-900 text-white rounded-[2rem] overflow-hidden">
          <CardHeader className="pb-2">
             <CardTitle className="text-lg font-bold flex items-center gap-2">
               <Zap className="h-5 w-5 text-amber-400" />
               Jornada Estimada
             </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
             <div className="flex items-end justify-between">
                <div>
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas de Trabajo</p>
                   <p className="text-3xl font-black text-white">{stats.total * 2.5}h</p>
                </div>
                <div className="text-right">
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Costo Proyectado</p>
                   <p className="text-xl font-bold text-amber-400">${stats.total * 35}</p>
                </div>
             </div>
             <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-amber-400 rounded-full transition-all duration-1000" 
                  style={{ width: `${(stats.completed / (stats.total || 1)) * 100}%` }}
                />
             </div>
             <p className="text-[10px] text-slate-400 font-medium">Progreso basado en tareas completadas ({stats.completed}/{stats.total})</p>
          </CardContent>
        </Card>
      </div>


      {/* ─── Main Content ───────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-12 gap-6">
        
        {/* Left Column: Tasks and Planning */}
        <div className="lg:col-span-8 space-y-6">
          
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
              filteredTasks.map((task) => {
                const priority = getPriorityInfo(task);
                const isWaitingReview = task.isWaitingValidation;
                
                return (
                  <Card key={task.id} className={cn(
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
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {getStatusBadge(task)}
                            <div className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border", priority.color)}>
                              <priority.icon className="h-3 w-3" />
                              {priority.label}
                            </div>
                            {!task.assigneeId && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-300 rounded-full animate-pulse">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Sin asignar</span>
                              </div>
                            )}
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
                                    onValueChange={(value) => {
                                      const member = team.find(m => m.id === value);
                                      setTasks(prev => prev.map(t =>
                                        t.id === task.id
                                          ? { ...t, assigneeId: value === "none" ? undefined : value, assigneeName: value === "none" ? undefined : member?.name, assigneeAvatar: value === "none" ? undefined : member?.avatar }
                                          : t
                                      ));
                                    }}
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
                           <div className="flex-1 px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                 <div className="h-8 w-8 rounded-full bg-white flex items-center justify-center text-slate-400 shadow-sm">
                                    <User className="h-4 w-4" />
                                 </div>
                                 <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6">
                                    <div>
                                       <p className="text-[9px] uppercase text-muted-foreground font-bold leading-none mb-1">
                                         Salida: {task.dueTime}
                                       </p>
                                       <p className="text-xs font-bold truncate max-w-[100px]">{task.guestName}</p>
                                    </div>
                                    {task.isBackToBack && task.arrivingGuestName && (
                                       <div className="pt-2 sm:pt-0 sm:pl-4 sm:border-l border-slate-200">
                                          <p className="text-[9px] uppercase text-emerald-600 font-bold leading-none mb-1">
                                            Entrada hoy
                                          </p>
                                          <p className="text-xs font-bold text-slate-700 truncate max-w-[100px]">{task.arrivingGuestName}</p>
                                       </div>
                                    )}
                                 </div>
                              </div>
                              {task.stayDuration && (
                                <Badge variant="secondary" className="bg-white text-[9px] h-5 font-bold border-slate-100">
                                  {task.stayDuration} noches
                                </Badge>
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
                              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider mb-2">
                                <span className="text-muted-foreground">Progreso de limpieza</span>
                                <span className={cn(
                                  task.status === "completed" ? "text-emerald-600" : "text-primary"
                                )}>
                                  {Math.round((task.checklist.filter(i => i.done).length / task.checklist.length) * 100)}%
                                </span>
                              </div>
                              <Progress 
                                value={(task.checklist.filter(i => i.done).length / task.checklist.length) * 100} 
                                className="h-1.5"
                              />
                           </div>
                           <Button variant="outline" size="sm" className="h-9 gap-2 group/btn">
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
                );
              })
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
            <CardContent className="p-4 space-y-4">
              {team.map((member) => (
                <div key={member.id} className="flex items-center gap-3 p-3 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-all group">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={member.avatar} />
                    <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{member.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium uppercase mt-0.5">
                       <span className={cn(
                         member.tasksToday > 3 ? "text-orange-500" : "text-emerald-500"
                       )}>
                         {member.tasksToday} tareas hoy
                       </span>
                       <span>•</span>
                       <span>{member.completedTasks} total</span>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all rounded-full bg-white shadow-soft">
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="w-full h-11 border-dashed border-2 hover:border-primary/50 gap-2 font-semibold">
                <UserPlus className="h-4 w-4 text-primary" />
                Invitar al equipo
              </Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-soft bg-gradient-to-br from-primary to-primary/80 text-primary-foreground overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 rotate-12">
               <Sparkles className="h-24 w-24" />
            </div>
            <CardContent className="p-6 relative z-10">
              <h4 className="text-lg font-bold mb-2">Optimización IA</h4>
              <p className="text-sm opacity-90 mb-4 leading-relaxed">
                Hoy tienes 2 propiedades con entrada inmediata. Hemos marcado estas tareas como "Prioridad Crítica" para que tu equipo empiece por ahí.
              </p>
              <Button variant="secondary" className="w-full bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-md">
                Optimizar rutas
              </Button>
            </CardContent>
          </Card>

          {/* Auto-assign status card */}
          {properties.some(p => p.autoAssignCleaner) && (
            <Card className="border-none shadow-soft overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-xl bg-emerald-100">
                    <Bot className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Asignación Automática Activa</p>
                    <p className="text-xs text-muted-foreground">{properties.filter(p => p.autoAssignCleaner).length} propiedad(es) configurada(s)</p>
                  </div>
                  <Zap className="h-4 w-4 text-amber-400 ml-auto" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Las nuevas tareas asignarán automáticamente al primer limpiador disponible según la prioridad configurada en cada propiedad.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="border-none shadow-soft">
             <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                   <AlertCircle className="h-5 w-5 text-rose-500" />
                   Incidencias activas
                </CardTitle>
             </CardHeader>
             <CardContent className="p-4 pt-0">
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 flex gap-3">
                   <div className="p-2 h-fit bg-white rounded-xl shadow-sm">
                      <Plus className="h-4 w-4 text-rose-500 rotate-45" />
                   </div>
                   <div>
                      <p className="text-sm font-bold text-rose-900">Grifo goteando</p>
                      <p className="text-xs text-rose-700/70">Villa Mar Azul • Reportado por Laura</p>
                      <Button variant="link" className="p-0 h-auto text-rose-600 font-bold text-xs mt-2">
                        Ver foto del daño
                      </Button>
                   </div>
                </div>
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
    </div>
  );
}
