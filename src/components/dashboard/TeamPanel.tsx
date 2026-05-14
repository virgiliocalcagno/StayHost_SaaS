"use client";

import { useState, useMemo, useEffect } from "react";

// Email master del SaaS — ahora leído de env var.
const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL ?? "").trim().toLowerCase();
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Users,
  UserPlus,
  Shield,
  Star,
  Phone,
  Mail,
  MapPin,
  MoreVertical,
  CheckCircle2,
  Clock,
  XCircle,
  Edit3,
  Trash2,
  MessageSquare,
  X,
  Home,
  Briefcase,
  Eye,
  EyeOff,
  ChevronDown,
  IdCard,
  Map,
  Lock,
  Trash,
  Fingerprint,
  Camera,
  Upload,
  Image as ImageIcon,
  Send,
  Copy,
  Link2,
  AlertCircle,
  CheckCheck,
  RefreshCw,
  KeyRound,
} from "lucide-react";
import { StaffAccessDialog } from "@/components/dashboard/StaffAccessDialog";
import { useTableSync } from "@/lib/realtime/useTableSync";

// ─── Types ──────────────────────────────────────────────────────────────────
interface TeamMember {
  id: string;
  authUserId?: string | null;
  name: string;
  email: string;
  /**
   * Identificador con el que el staff loguea — email real (si lo hay) o
   * teléfono (cuando la cuenta usa pseudo-email interno). Backend lo
   * resuelve y lo manda en el DTO. UI lo usa para WhatsApp y display.
   */
  loginIdentifier?: string;
  phone: string;
  avatar?: string;
  role: "admin" | "manager" | "cleaner" | "co_host" | "maintenance" | "guest_support" | "owner" | "accountant";
  status: "active" | "inactive" | "pending";
  available: boolean;
  properties: number;
  tasksCompleted: number;
  tasksToday: number;
  rating: number;
  ratingCount?: number;
  joinDate: string;
  lastActive: string;
  // Permissions & access
  permissions?: {
    canViewAnalytics: boolean;
    canManageTasks: boolean;
    canMessageGuests: boolean;
    canEditProperties: boolean;
  };
  propertyAccess?: "all" | string[];
  notificationPrefs?: { whatsapp: boolean; email: boolean };
  // Nuevos campos
  documentId?: string;
  emergencyPhone?: string;
  address?: string;
  references?: { name: string; phone: string }[];
  password?: string;
  documentPhoto?: string;
}

// ─── Role Configs ───────────────────────────────────────────────────────────
const roleConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  admin: {
    label: "Administrador",
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-purple-700 dark:text-purple-300",
    bgColor: "bg-purple-100 dark:bg-purple-900/40 border-purple-200 dark:border-purple-800",
  },
  manager: {
    label: "Gerente",
    icon: <Briefcase className="h-3.5 w-3.5" />,
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800",
  },
  co_host: {
    label: "Co-anfitrión",
    icon: <Star className="h-3.5 w-3.5" />,
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800",
  },
  cleaner: {
    label: "Limpieza",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: "text-emerald-700 dark:text-emerald-300",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-800",
  },
  maintenance: {
    label: "Mantenimiento",
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-orange-700 dark:text-orange-300",
    bgColor: "bg-orange-100 dark:bg-orange-900/40 border-orange-200 dark:border-orange-800",
  },
  guest_support: {
    label: "Soporte",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    color: "text-indigo-700 dark:text-indigo-300",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/40 border-indigo-200 dark:border-indigo-800",
  },
  owner: {
    // El SaaS Master (nivel Dios) — máximos permisos, visible con color dorado
    // distinto del resto del equipo para que quede obvio quién manda.
    label: "Dios · SaaS Master",
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-amber-800 dark:text-amber-200",
    bgColor: "bg-gradient-to-r from-amber-200 to-yellow-100 dark:from-amber-900/60 dark:to-yellow-900/40 border-amber-400 dark:border-amber-700",
  },
  accountant: {
    label: "Contador",
    icon: <IdCard className="h-3.5 w-3.5" />,
    color: "text-teal-700 dark:text-teal-300",
    bgColor: "bg-teal-100 dark:bg-teal-900/40 border-teal-200 dark:border-teal-800",
  },
};

// ─── Component ──────────────────────────────────────────────────────────────
export default function TeamPanel() {
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [accessDialogMember, setAccessDialogMember] = useState<TeamMember | null>(null);
  const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordSaving, setResetPasswordSaving] = useState(false);
  const [isClient, setIsClient] = useState(false);
  
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Helper: re-fetcha el team. Se usa al montar y cuando llega evento Realtime.
  const refetchTeam = async () => {
    try {
      const res = await fetch("/api/team-members", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { members: TeamMember[] };
      setTeam(data.members ?? []);
    } catch (e) {
      console.warn("[TeamPanel] realtime refetch failed", e);
    }
  };

  // Tenant ID para suscribir Realtime. Lo levantamos de /api/me al montar.
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((me: { tenantId: string | null } | null) => {
        if (me?.tenantId) setTenantId(me.tenantId);
      })
      .catch(() => {});
  }, []);

  // Realtime: status pending→active al instante cuando una limpiadora
  // hace su primer login. También captura cualquier cambio de role,
  // available, etc desde otra sesión.
  useTableSync({
    table: "team_members",
    filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined,
    enabled: !!tenantId,
    onChange: () => refetchTeam(),
  });

  // Fuente de verdad: Supabase via /api/team-members. Sin localStorage —
  // leakeaba team entre tenants en el mismo browser.
  useEffect(() => {
    setIsClient(true);

    (async () => {
      try {
        const res = await fetch("/api/team-members", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return; // sin tenant / error → nos quedamos con caché
        const data = (await res.json()) as { members: TeamMember[] };
        const remote = data.members ?? [];
        setTeam(remote);

        // 3) Auto-seed del master (Virgilio) si está autenticado y no aparece.
        try {
          const authRes = await fetch("/api/me", {
            cache: "no-store",
            credentials: "include",
          });
          if (!authRes.ok) return;
          const me = (await authRes.json()) as { email: string | null; isMaster: boolean };
          if (!me.isMaster || !me.email) return;

          const already = remote.some(
            (m) => m.email.trim().toLowerCase() === MASTER_EMAIL
          );
          if (already) return;

          const today = (() => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${dd}`;
          })();

          const masterDto: TeamMember = {
            id: "virgilio-pending",
            name: "Virgilio Calcagno",
            email: MASTER_EMAIL,
            phone: "",
            role: "owner",
            status: "active",
            available: true,
            properties: 0,
            tasksCompleted: 0,
            tasksToday: 0,
            rating: 5,
            joinDate: today,
            lastActive: "En línea",
            permissions: {
              canViewAnalytics: true,
              canManageTasks: true,
              canMessageGuests: true,
              canEditProperties: true,
            },
            propertyAccess: "all",
            notificationPrefs: { whatsapp: true, email: true },
          };

          const postRes = await fetch("/api/team-members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(masterDto),
          });
          if (postRes.ok) {
            const created = (await postRes.json()) as { member: TeamMember };
            setTeam((prev) => {
              // Evitar duplicados si el usuario también recibió la lista.
              const dedup = prev.filter(
                (m) => m.email.trim().toLowerCase() !== MASTER_EMAIL
              );
              return [created.member, ...dedup];
            });
          }
        } catch { /* noop */ }
      } catch { /* noop */ }
      finally {
        setTeamLoading(false);
      }
    })();
  }, []);

  // Cargar propiedades reales para el selector del Paso 3 — desde API,
  // no desde localStorage (leakeaba properties del tenant anterior).
  useEffect(() => {
    fetch("/api/properties", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = Array.isArray(data?.properties) ? data.properties : [];
        setSavedProperties(list.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {});
  }, []);

  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [savedProperties, setSavedProperties] = useState<{ id: string; name: string }[]>([]);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Form state
  const [inviteStep, setInviteStep] = useState<"info" | "roles" | "properties" | "confirm">("info");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "cleaner" as TeamMember["role"],
    documentId: "",
    emergencyPhone: "",
    address: "",
    references: [] as { name: string; phone: string }[],
    password: "",
    documentPhoto: "",
    permissions: {
      canViewAnalytics: false,
      canManageTasks: true,
      canMessageGuests: false,
      canEditProperties: false,
    },
    propertyAccess: "all" as "all" | string[],
    notificationPrefs: { whatsapp: true, email: true },
  });

  // ─── Reference Handlers ────────────────────────────────────────────────────
  const handleAddReference = () => {
    setFormData((prev) => ({
      ...prev,
      references: [...prev.references, { name: "", phone: "" }],
    }));
  };

  const handleRemoveReference = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      references: prev.references.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateReference = (index: number, field: "name" | "phone", value: string) => {
    setFormData((prev) => ({
      ...prev,
      references: prev.references.map((ref, i) =>
        i === index ? { ...ref, [field]: value } : ref
      ),
    }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, documentPhoto: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  // ─── Filtered Members ──────────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    return team.filter((member) => {
      const matchesSearch =
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesRole = 
        roleFilter === "all" ? true :
        roleFilter === "pending_only" ? member.status === "pending" :
        member.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [team, searchTerm, roleFilter]);

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = team.filter((m) => m.status === "active").length;
    const available = team.filter((m) => m.available).length;
    const pending = team.filter((m) => m.status === "pending").length;
    const totalTasksToday = team.reduce((acc, m) => acc + m.tasksToday, 0);
    return { total: team.length, active, available, pending, totalTasksToday };
  }, [team]);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleOpenAdd = () => {
    setEditingMember(null);
    setInviteStep("info");
    setFormData({
      name: "",
      email: "",
      phone: "",
      role: "cleaner",
      documentId: "",
      emergencyPhone: "",
      address: "",
      references: [],
      password: "",
      documentPhoto: "",
      permissions: { canViewAnalytics: false, canManageTasks: true, canMessageGuests: false, canEditProperties: false },
      propertyAccess: "all",
      notificationPrefs: { whatsapp: true, email: true },
    });
    setShowModal(true);
  };

  const handleOpenEdit = (member: TeamMember) => {
    setEditingMember(member);
    setInviteStep("info");
    setFormData({
      name: member.name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      documentId: member.documentId || "",
      emergencyPhone: member.emergencyPhone || "",
      address: member.address || "",
      references: member.references || [],
      password: member.password || "",
      documentPhoto: member.documentPhoto || "",
      permissions: member.permissions || { canViewAnalytics: false, canManageTasks: false, canMessageGuests: false, canEditProperties: false },
      propertyAccess: member.propertyAccess || "all",
      notificationPrefs: member.notificationPrefs || { whatsapp: true, email: true },
    });
    setShowModal(true);
  };

  // Todas las mutaciones van al backend (/api/team-members) y luego
  // actualizamos el estado local con la respuesta para quedar sincronizados.
  // Si el backend falla, revertimos y mostramos un alert — sin silencios.
  const handleSave = async () => {
    // Validación: nombre + (email o teléfono). Para nuevos miembros además
    // password ≥6. La API también valida — esto es solo UX para no perder
    // el round-trip.
    if (!formData.name) {
      alert("El nombre es requerido");
      return;
    }
    const hasEmail = formData.email && formData.email.includes("@");
    const hasPhone = !!formData.phone && formData.phone.replace(/\D/g, "").length >= 8;
    if (!hasEmail && !hasPhone) {
      alert("Debes proporcionar un email o un teléfono válido");
      return;
    }
    if (!editingMember && (!formData.password || formData.password.length < 6)) {
      alert("La contraseña es requerida (mínimo 6 caracteres)");
      return;
    }

    // Construye el payload que entiende la API (camelCase DTO).
    const payload: Record<string, unknown> = {
      name: formData.name,
      email: hasEmail ? formData.email : undefined,
      phone: formData.phone,
      role: formData.role,
      documentId: formData.documentId,
      emergencyPhone: formData.emergencyPhone,
      address: formData.address,
      references: formData.references,
      documentPhoto: formData.documentPhoto,
      permissions: formData.permissions,
      propertyAccess: formData.propertyAccess,
      notificationPrefs: formData.notificationPrefs,
    };
    if (!editingMember && formData.password) {
      // Solo mandamos password al CREAR — el reset usa endpoint dedicado.
      payload.password = formData.password;
    }

    try {
      if (editingMember) {
        const res = await fetch(
          `/api/team-members?id=${encodeURIComponent(editingMember.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || "No se pudo guardar el miembro");
          return;
        }
        const data = (await res.json()) as { member: TeamMember };
        setTeam((prev) =>
          prev.map((m) => (m.id === editingMember.id ? data.member : m))
        );
      } else {
        // Defaults para un miembro nuevo: queda como pending hasta su 1er login.
        const createPayload = {
          ...payload,
          status: "pending",
          available: false,
        };
        const res = await fetch("/api/team-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(createPayload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || "No se pudo crear el miembro");
          return;
        }
        const data = (await res.json()) as { member: TeamMember };
        setTeam((prev) => [data.member, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      alert("Error de red al guardar el miembro");
      console.error(e);
    }
  };

  const handleToggleAvailability = async (id: string) => {
    const current = team.find((m) => m.id === id);
    if (!current) return;
    const next = !current.available;

    // Optimista: actualizamos primero la UI, después sincronizamos.
    setTeam((prev) =>
      prev.map((m) => (m.id === id ? { ...m, available: next } : m))
    );

    try {
      const res = await fetch(
        `/api/team-members?id=${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ available: next }),
        }
      );
      if (!res.ok) {
        // Revertir si la API rechazó el cambio.
        setTeam((prev) =>
          prev.map((m) => (m.id === id ? { ...m, available: current.available } : m))
        );
      }
    } catch {
      setTeam((prev) =>
        prev.map((m) => (m.id === id ? { ...m, available: current.available } : m))
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este miembro del equipo? Esta acción no se puede deshacer.")) {
      return;
    }

    const prevTeam = team;
    // Optimista: sacamos al miembro de la UI de inmediato.
    setTeam((prev) => prev.filter((m) => m.id !== id));

    try {
      const res = await fetch(
        `/api/team-members?id=${encodeURIComponent(id)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "No se pudo eliminar el miembro");
        setTeam(prevTeam); // revertir
      }
    } catch {
      alert("Error de red al eliminar el miembro");
      setTeam(prevTeam);
    }
  };

  const getRoleBadge = (role: string) => {
    const config = roleConfig[role] || roleConfig.cleaner;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.bgColor} ${config.color}`}>
        {config.icon}
        {config.label}
      </span>
    );
  };

  const getStatusDot = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-emerald-500",
      inactive: "bg-gray-400",
      pending: "bg-amber-500 animate-pulse",
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.inactive}`} />;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Mi Equipo</h2>
          <p className="text-muted-foreground">
            Gestiona los miembros de tu equipo y sus permisos de acceso
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="gradient-gold text-primary-foreground gap-2">
          <UserPlus className="h-4 w-4" />
          Nuevo Miembro
        </Button>
      </div>

      {/* ─── Stats ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.available}</p>
              <p className="text-sm text-muted-foreground">Disponibles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-sm text-muted-foreground">Pendientes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-500/10">
              <Briefcase className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalTasksToday}</p>
              <p className="text-sm text-muted-foreground">Tareas Hoy</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Toolbar ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">Todos los Miembros</option>
            <option value="pending_only">Pendientes / Invitados</option>
            <option value="admin">Administradores</option>
            <option value="manager">Gerentes</option>
            <option value="owner">Propietarios</option>
            <option value="co_host">Co-anfitriones</option>
            <option value="accountant">Contadores</option>
            <option value="guest_support">Soporte</option>
            <option value="cleaner">Limpieza</option>
            <option value="maintenance">Mantenimiento</option>
          </select>
          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`p-2.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Content ─────────────────────────────────────────────────────── */}
      {teamLoading ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Cargando equipo…
          </CardContent>
        </Card>
      ) : team.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">Aún no tenés miembros en el equipo</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Invitá a tu primer miembro: cleaners, mantenimiento, co-host. Vas a poder asignarles propiedades y permisos específicos.
            </p>
            <Button onClick={handleOpenAdd} className="gradient-gold text-primary-foreground gap-2 mx-auto">
              <UserPlus className="h-4 w-4" /> Invitar primer miembro
            </Button>
          </CardContent>
        </Card>
      ) : filteredMembers.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No se encontraron miembros</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Ajustá los filtros o invitá a alguien nuevo al equipo.
            </p>
            <Button onClick={handleOpenAdd} className="gradient-gold text-primary-foreground gap-2 mx-auto">
              <UserPlus className="h-4 w-4" /> Invitar Nuevo Miembro
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        /* ─── LIST VIEW ─────────────────────────────────────────────────── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Miembro</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contacto</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rol</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Propiedades</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rendimiento</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-right p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member) => (
                    <tr
                      key={member.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors group"
                    >
                      {/* Avatar + Name */}
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-10 w-10 ring-2 ring-background">
                              <AvatarImage src={member.avatar} />
                              <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                {member.name.split(" ").map((n) => n[0]).join("")}
                              </AvatarFallback>
                            </Avatar>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${member.available ? "bg-emerald-500" : "bg-gray-400"}`} />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{member.name}</p>
                            <p className="text-xs text-muted-foreground">{member.lastActive}</p>
                          </div>
                        </div>
                      </td>
                      {/* Contact */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            title={member.email}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors"
                          >
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            title={member.phone}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors"
                          >
                            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            title="WhatsApp"
                            onClick={() => window.open(`https://wa.me/${member.phone.replace(/\D/g, "")}`, "_blank")}
                            className="p-1.5 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                          </button>
                        </div>
                      </td>
                      {/* Role */}
                      <td className="p-4">{getRoleBadge(member.role)}</td>
                      {/* Properties */}
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Home className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{member.properties}</span>
                        </div>
                      </td>
                      {/* Performance */}
                      <td className="p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-sm">
                            <span className="font-medium">{member.tasksCompleted}</span>
                            <span className="text-muted-foreground text-xs">completadas</span>
                          </div>
                          {member.rating > 0 && (
                            <div className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                              <span className="text-xs font-medium">{member.rating.toFixed(1)}</span>
                              {member.ratingCount ? (
                                <span className="text-[10px] text-muted-foreground">({member.ratingCount})</span>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Status */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getStatusDot(member.status)}
                          <span className="text-sm capitalize">
                            {member.status === "active"
                              ? "Activo"
                              : member.status === "pending"
                                ? "Pendiente"
                                : "Inactivo"}
                          </span>
                        </div>
                      </td>
                      {/* Actions */}
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {member.status === "pending" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const phone = member.phone.replace(/\D/g, "");
                                const identifier = member.loginIdentifier || member.email || member.phone;
                                const msg = `Hola ${member.name}, te invité al equipo de StayHost 🏠\n\nIngresá en: ${window.location.origin}/acceso\nUsuario: ${identifier}\n\nSi olvidaste tu contraseña, avisame y te genero una nueva.`;
                                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                              }}
                              title="Reenviar invitación por WhatsApp"
                              className="p-2 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-amber-500"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleAvailability(member.id)}
                            title={member.available ? "Marcar no disponible" : "Marcar disponible"}
                            className={`p-2 rounded-md transition-colors ${member.available ? "hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500" : "hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-500"}`}
                          >
                            {member.available ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          {(member.role === "cleaner" || member.role === "maintenance" || member.role === "co_host") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setAccessDialogMember(member); }}
                              title="Gestionar accesos a propiedades"
                              className="p-2 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-amber-600"
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                          )}
                          {member.authUserId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setResetPasswordMember(member);
                                setResetPasswordValue("");
                              }}
                              title="Resetear contraseña de acceso"
                              className="p-2 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors text-purple-600"
                            >
                              <Lock className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(member)}
                            className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(member.id)}
                            className="p-2 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ─── GRID VIEW ─────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map((member) => (
            <Card
              key={member.id}
              className="group hover:shadow-soft transition-all duration-300 hover:-translate-y-0.5 cursor-pointer overflow-hidden"
              onClick={() => handleOpenEdit(member)}
            >
              {/* Gradient Top Bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40" />
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12 ring-2 ring-background shadow-sm">
                        <AvatarImage src={member.avatar} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                          {member.name.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background ${member.available ? "bg-emerald-500" : "bg-gray-400"}`} />
                    </div>
                    <div>
                      <p className="font-semibold">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.lastActive}</p>
                    </div>
                  </div>
                  {getStatusDot(member.status)}
                </div>

                <div className="mb-4">{getRoleBadge(member.role)}</div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50 mb-4">
                  <div className="text-center">
                    <p className="text-lg font-bold">{member.properties}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Propiedades</p>
                  </div>
                  <div className="text-center border-x border-border">
                    <p className="text-lg font-bold">{member.tasksCompleted}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Completadas</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold flex items-center justify-center gap-1">
                      {member.rating > 0 ? (
                        <>
                          {member.rating.toFixed(1)}
                          <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                          {member.ratingCount ? (
                            <span className="text-[10px] text-muted-foreground ml-0.5">({member.ratingCount})</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Rating</p>
                  </div>
                </div>

                {/* Contact Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-border hover:bg-muted transition-colors text-xs font-medium"
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`https://wa.me/${member.phone.replace(/\D/g, "")}`, "_blank");
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors text-xs font-medium border border-emerald-200 dark:border-emerald-800"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                  </button>
                  {member.status === "pending" ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const phone = member.phone.replace(/\D/g, "");
                        const identifier = member.loginIdentifier || member.email || member.phone;
                        const msg = `Hola ${member.name}, te invité al equipo de StayHost 🏠\n\nIngresá en: ${window.location.origin}/acceso\nUsuario: ${identifier}\n\nSi olvidaste tu contraseña, avisame y te genero una nueva.`;
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                      }}
                      className="p-2 rounded-md border transition-colors border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600"
                      title="Reenviar invitación por WhatsApp"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleAvailability(member.id);
                      }}
                      className={`p-2 rounded-md border transition-colors ${member.available ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600" : "border-border bg-muted text-muted-foreground"}`}
                      title={member.available ? "Disponible" : "No disponible"}
                    >
                      {member.available ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {(member.role === "cleaner" || member.role === "maintenance" || member.role === "co_host") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAccessDialogMember(member); }}
                      title="Gestionar accesos a propiedades"
                      className="p-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Modal: Add/Edit Member (Wizard en 3 Pasos) ──────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />

          <div className="relative w-full max-w-2xl bg-background rounded-2xl shadow-2xl border overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            {/* Gradient Header & Tabs */}
            <div className="p-6 pb-0 bg-gradient-to-r from-primary/5 via-primary/10 to-transparent border-b shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    {editingMember ? <Edit3 className="h-5 w-5 text-primary" /> : <UserPlus className="h-5 w-5 text-primary" />}
                    {editingMember ? "Editar Miembro de Equipo" : "Invitar al Equipo"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Configura la información, roles y propiedades asignadas.
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex">
                <button onClick={() => setInviteStep("info")}
                  className={`flex-1 pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${inviteStep === "info" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${inviteStep === "info" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>1</span>
                  Información
                </button>
                <button onClick={() => setInviteStep("roles")}
                  className={`flex-1 pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${inviteStep === "roles" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${inviteStep === "roles" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</span>
                  Rol y Permisos
                </button>
                <button onClick={() => setInviteStep("properties")}
                  className={`flex-1 pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${inviteStep === "properties" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${inviteStep === "properties" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>3</span>
                  Acceso
                </button>
                <button onClick={() => setInviteStep("confirm")}
                  className={`flex-1 pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${inviteStep === "confirm" ? "border-emerald-500 text-emerald-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${inviteStep === "confirm" ? "bg-emerald-500 text-white" : "bg-muted"}`}>4</span>
                  Confirmar
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              
              {/* STEP 1: INFORMACIÓN PERSONAL */}
              {inviteStep === "info" && (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
                  {/* SECCIÓN: DATOS BÁSICOS */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
                        <Users className="h-4 w-4" />
                      </span>
                      <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">👤 Datos Básicos</h4>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="member-name" className="text-sm font-medium">Nombre Completo</Label>
                        <Input
                          id="member-name"
                          placeholder="Ej. María López..."
                          value={formData.name}
                          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-email" className="text-sm font-medium">
                          Email <span className="text-muted-foreground font-normal">(opcional si hay teléfono)</span>
                        </Label>
                        <Input
                          id="member-email"
                          type="email"
                          placeholder="ejemplo@correo.com"
                          value={formData.email}
                          onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                          disabled={!!editingMember}
                        />
                        {editingMember && (
                          <p className="text-xs text-muted-foreground">
                            El email/teléfono no se puede cambiar después de crear la cuenta.
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="member-phone" className="text-sm font-medium">
                          Teléfono <span className="text-muted-foreground font-normal">(WhatsApp + login)</span>
                        </Label>
                        <Input
                          id="member-phone"
                          placeholder="+18295551234"
                          value={formData.phone}
                          onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                          disabled={!!editingMember}
                        />
                        <p className="text-xs text-muted-foreground">
                          Si el miembro no tiene email, ingresá su teléfono — podrá loguearse con ese número.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* PREFERENCIAS DE NOTIFICACIÓN */}
                  <div className="space-y-4">
                     <div className="flex items-center gap-2 pb-2 border-b">
                      <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                        <Mail className="h-4 w-4" />
                      </span>
                      <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Avisos y Alertas</h4>
                    </div>
                    <div className="flex gap-6">
                      <Label className="flex items-center gap-2 cursor-pointer font-normal">
                        <input type="checkbox" checked={formData.notificationPrefs.email} onChange={(e) => setFormData(prev => ({...prev, notificationPrefs: {...prev.notificationPrefs, email: e.target.checked}}))} className="rounded text-primary focus:ring-primary w-4 h-4"/>
                        Recibir Notificaciones por Email
                      </Label>
                      <Label className="flex items-center gap-2 cursor-pointer font-normal">
                        <input type="checkbox" checked={formData.notificationPrefs.whatsapp} onChange={(e) => setFormData(prev => ({...prev, notificationPrefs: {...prev.notificationPrefs, whatsapp: e.target.checked}}))} className="rounded text-emerald-500 focus:ring-emerald-500 w-4 h-4"/>
                        Recibir Mensajes por WhatsApp
                      </Label>
                    </div>
                  </div>

                  {/* SECCIÓN: DOCUMENTACIÓN */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                        <IdCard className="h-4 w-4" />
                      </span>
                      <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">🪪 Verificación y Seguridad</h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="documentId" className="text-sm font-medium">Documento Identidad Oficial</Label>
                        <Input
                          id="documentId"
                          placeholder="001-0000000-0"
                          value={formData.documentId}
                          onChange={(e) => setFormData((prev) => ({ ...prev, documentId: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="emergencyPhone" className="text-sm font-medium">Teléfono de Emergencia</Label>
                        <Input
                          id="emergencyPhone"
                          placeholder="Contacto directo..."
                          value={formData.emergencyPhone}
                          onChange={(e) => setFormData((prev) => ({ ...prev, emergencyPhone: e.target.value }))}
                        />
                      </div>
                      {!editingMember && (
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="member-pass" className="text-sm font-medium flex items-center gap-2">
                            <Fingerprint className="h-4 w-4 text-purple-500" />
                            Contraseña de Primer Ingreso
                          </Label>
                          <Input
                            id="member-pass"
                            type="password"
                            placeholder="Mínimo 6 caracteres"
                            value={formData.password}
                            onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                          />
                          <p className="text-[10px] text-muted-foreground italic">
                            El miembro usará esta clave para entrar a la App. Si la olvida, podrás resetearla desde la lista.
                          </p>
                        </div>
                      )}
                      {editingMember && (
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-sm font-medium flex items-center gap-2">
                            <Fingerprint className="h-4 w-4 text-purple-500" />
                            Contraseña
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Para cambiar la contraseña, cerrá este modal y tocá el icono de candado en la fila del miembro.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: ROLES Y PERMISOS */}
              {inviteStep === "roles" && (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
                  {/* Disclaimer: hoy las permissions se guardan pero no se aplican
                      todavia. Importante avisarlo para que el usuario no asuma
                      que un "Limpieza" no puede ver financieros. */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-200">
                    <strong>En desarrollo:</strong> los permisos se guardan correctamente,
                    pero la aplicación granular en el panel está en próxima fase.
                    Por ahora todo miembro invitado verá tu panel completo. Invitalos
                    sólo a personas de confianza.
                  </div>
                  <div className="space-y-4">
                    <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">1. Seleccionar Perfil Principal</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {Object.entries(roleConfig)
                        // El rol "owner" es para SaaS Master / dueño del tenant
                        // (Virgilio o Master delegado), no para invitar staff.
                        // Filtrarlo del wizard cierra el agujero conceptual donde
                        // un cliente podia crear un staff con label "Dios".
                        .filter(([key]) => key !== "owner")
                        .map(([key, config]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            const newRole = key as TeamMember["role"];
                            // Auto-ajustar permisos al elegir rol (UX Dinámico)
                            const autoPerms = {
                              admin: { canViewAnalytics: true, canManageTasks: true, canMessageGuests: true, canEditProperties: true },
                              manager: { canViewAnalytics: true, canManageTasks: true, canMessageGuests: true, canEditProperties: false },
                              cleaner: { canViewAnalytics: false, canManageTasks: true, canMessageGuests: false, canEditProperties: false },
                              maintenance: { canViewAnalytics: false, canManageTasks: true, canMessageGuests: false, canEditProperties: false },
                              guest_support: { canViewAnalytics: false, canManageTasks: false, canMessageGuests: true, canEditProperties: false },
                              owner: { canViewAnalytics: true, canManageTasks: false, canMessageGuests: false, canEditProperties: false },
                              accountant: { canViewAnalytics: true, canManageTasks: false, canMessageGuests: false, canEditProperties: false },
                              co_host: { canViewAnalytics: true, canManageTasks: true, canMessageGuests: true, canEditProperties: false },
                            };
                            setFormData((prev) => ({ 
                              ...prev, 
                              role: newRole,
                              permissions: autoPerms[newRole]
                            }));
                          }}
                          className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all gap-2 ${
                            formData.role === key
                              ? "border-primary bg-primary/5 shadow-md scale-105"
                              : "border-border hover:border-primary/30 hover:bg-muted/50"
                          }`}
                        >
                          <span className={`p-3 rounded-full ${config.bgColor} ${config.color}`}>{config.icon}</span>
                          <span className="text-xs font-semibold">{config.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">2. Ajuste Fino de Permisos Individuales</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      
                      <label className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-colors ${formData.permissions.canViewAnalytics ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                        <div className="pt-0.5">
                          <input type="checkbox" className="w-5 h-5 rounded text-primary focus:ring-primary accent-primary" 
                                 checked={formData.permissions.canViewAnalytics}
                                 onChange={(e) => setFormData(prev => ({...prev, permissions: {...prev.permissions, canViewAnalytics: e.target.checked}}))} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Ver Financieros y Analíticas</p>
                          <p className="text-xs text-muted-foreground mt-1">Acceso total al Revenue, ocupación y facturación.</p>
                        </div>
                      </label>

                      <label className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-colors ${formData.permissions.canManageTasks ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                        <div className="pt-0.5">
                          <input type="checkbox" className="w-5 h-5 rounded text-primary focus:ring-primary accent-primary" 
                                 checked={formData.permissions.canManageTasks}
                                 onChange={(e) => setFormData(prev => ({...prev, permissions: {...prev.permissions, canManageTasks: e.target.checked}}))} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Gestionar Tareas Operativas</p>
                          <p className="text-xs text-muted-foreground mt-1">Puede aceptar, completar y registrar limpiezas/reparaciones.</p>
                        </div>
                      </label>

                      <label className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-colors ${formData.permissions.canMessageGuests ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                        <div className="pt-0.5">
                          <input type="checkbox" className="w-5 h-5 rounded text-primary focus:ring-primary accent-primary" 
                                 checked={formData.permissions.canMessageGuests}
                                 onChange={(e) => setFormData(prev => ({...prev, permissions: {...prev.permissions, canMessageGuests: e.target.checked}}))} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Escribir a los Huéspedes</p>
                          <p className="text-xs text-muted-foreground mt-1">Permite chatear en nombre de la propiedad.</p>
                        </div>
                      </label>

                      <label className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-colors ${formData.permissions.canEditProperties ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                        <div className="pt-0.5">
                          <input type="checkbox" className="w-5 h-5 rounded text-primary focus:ring-primary accent-primary" 
                                 checked={formData.permissions.canEditProperties}
                                 onChange={(e) => setFormData(prev => ({...prev, permissions: {...prev.permissions, canEditProperties: e.target.checked}}))} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Editar Propiedades Maestras</p>
                          <p className="text-xs text-muted-foreground mt-1">Modifica precios, fotos maestras y amenities del anuncio.</p>
                        </div>
                      </label>
                      
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: ACCESO A PROPIEDADES */}
              {inviteStep === "properties" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                  <div className="bg-primary/10 p-4 rounded-xl flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-primary">
                      Al limitar el acceso, este usuario solo verá las reservas, tareas y chats de los alojamientos que tú le permitas explícitamente.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-center gap-3 p-4 rounded-xl border border-primary bg-primary/5 cursor-pointer">
                      <input 
                        type="radio" 
                        name="prop-access" 
                        checked={formData.propertyAccess === "all"} 
                        onChange={() => setFormData(prev => ({...prev, propertyAccess: "all"}))}
                        className="w-4 h-4 text-primary accent-primary"
                      />
                      <div className="flex-1">
                        <p className="font-bold text-sm">Acceso Global (Todas las Activas)</p>
                        <p className="text-xs text-muted-foreground">Ideal para staff gerencial, administradores o supervisores generales.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-4 rounded-xl border hover:bg-muted/30 cursor-pointer">
                      <input 
                        type="radio" 
                        name="prop-access" 
                        checked={Array.isArray(formData.propertyAccess)} 
                        onChange={() => setFormData(prev => ({...prev, propertyAccess: []}))}
                        className="w-4 h-4 text-primary accent-primary"
                      />
                      <div className="flex-1">
                        <p className="font-bold text-sm">Acceso Exclusivo (Selección Manual)</p>
                        <p className="text-xs text-muted-foreground">Para operarios que solo trabajan en locaciones específicas o dueños de un Airbnb.</p>
                      </div>
                    </label>
                  </div>

                  {Array.isArray(formData.propertyAccess) && (
                    <div className="p-4 border rounded-xl bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selecciona las unidades</p>
                        {savedProperties.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {(formData.propertyAccess as string[]).length} / {savedProperties.length} seleccionadas
                          </span>
                        )}
                      </div>
                      {savedProperties.length === 0 ? (
                        <div className="py-6 text-center space-y-2">
                          <Home className="h-8 w-8 mx-auto text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">No hay propiedades registradas.</p>
                          <p className="text-xs text-muted-foreground">Crea propiedades primero en la sección Propiedades.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                          {savedProperties.map((prop) => {
                            const isChecked = (formData.propertyAccess as string[]).includes(prop.id);
                            return (
                              <label key={prop.id} className={`flex items-center gap-3 p-3 bg-background rounded-lg border-2 cursor-pointer text-sm font-medium transition-all ${isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const current = formData.propertyAccess as string[];
                                    if (e.target.checked) setFormData(p => ({ ...p, propertyAccess: [...current, prop.id] }));
                                    else setFormData(p => ({ ...p, propertyAccess: current.filter(x => x !== prop.id) }));
                                  }}
                                  className="accent-primary w-4 h-4"
                                />
                                <span className="flex-1 truncate">{prop.name}</span>
                                {isChecked && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

              {/* STEP 4: CONFIRMAR & ENVIAR */}
              {inviteStep === "confirm" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                  {/* Preview card */}
                  <div className="p-5 rounded-2xl border-2 border-primary/20 bg-primary/5 space-y-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-14 w-14 ring-2 ring-primary/20">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                          {formData.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-lg font-bold">{formData.name || "—"}</p>
                        <p className="text-sm text-muted-foreground">{formData.email}</p>
                        <div className="mt-1.5">{getRoleBadge(formData.role)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{formData.phone || "—"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Home className="h-3.5 w-3.5 shrink-0" />
                        <span>{formData.propertyAccess === "all" ? "Todas las propiedades" : `${(formData.propertyAccess as string[]).length} propiedad(es)`}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span>{formData.notificationPrefs.email ? "Email activado" : "Sin email"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                        <span>{formData.notificationPrefs.whatsapp ? "WhatsApp activado" : "Sin WhatsApp"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Send options */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Enviar acceso por</p>
                    <button
                      type="button"
                      onClick={() => {
                        const phone = formData.phone.replace(/\D/g, "");
                        const portalUrl = `${window.location.origin}/acceso`;
                        // Identificador de login: email real si lo hay, si no
                        // el teléfono normalizado (que el staff conoce de memoria).
                        const identifier = formData.email && formData.email.includes("@")
                          ? formData.email
                          : (formData.phone.startsWith("+") ? formData.phone : `+${formData.phone.replace(/\D/g, "")}`);
                        const msg = `Hola ${formData.name}, te invité al equipo de StayHost 🏠\n\nIngresá en: ${portalUrl}\nUsuario: ${identifier}${formData.password ? `\nClave: ${formData.password}` : ""}\n\nDespués podés cambiar tu contraseña. Cualquier duda respondeme acá.`;
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                      }}
                      disabled={!formData.phone}
                      className="w-full flex items-center gap-3 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <MessageSquare className="h-5 w-5 shrink-0" />
                      <div className="text-left">
                        <p className="font-semibold text-sm">Enviar por WhatsApp</p>
                        <p className="text-xs opacity-75">{formData.phone || "Agrega un teléfono en el paso 1"}</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const link = `${window.location.origin}/acceso?email=${encodeURIComponent(formData.email)}`;
                        navigator.clipboard.writeText(link).then(() => {
                          setInviteCopied(true);
                          setTimeout(() => setInviteCopied(false), 2500);
                        });
                      }}
                      className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-colors ${inviteCopied ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "border-border hover:bg-muted/50"}`}
                    >
                      {inviteCopied ? <CheckCheck className="h-5 w-5 shrink-0 text-emerald-600" /> : <Copy className="h-5 w-5 shrink-0" />}
                      <div className="text-left">
                        <p className="font-semibold text-sm">{inviteCopied ? "¡Enlace copiado!" : "Copiar enlace de acceso"}</p>
                        <p className="text-xs text-muted-foreground">staff.stayhost.com/acceso</p>
                      </div>
                    </button>
                  </div>

                  {/* Warning note */}
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      El miembro aparecerá como <strong>Pendiente</strong> hasta que inicie sesión por primera vez en la app. Una vez activo, recibirá notificaciones automáticas de sus tareas asignadas.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer / Botones Navegación Wizard */}
            <div className="p-6 pt-4 border-t flex items-center justify-between shrink-0 bg-muted/10">
              {inviteStep !== "info" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (inviteStep === "roles") setInviteStep("info");
                    else if (inviteStep === "properties") setInviteStep("roles");
                    else setInviteStep("properties");
                  }}
                  className="gap-2"
                >
                  Volver
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
              )}

              {inviteStep !== "confirm" ? (
                <Button
                  onClick={() => {
                    if (inviteStep === "info") setInviteStep("roles");
                    else if (inviteStep === "roles") setInviteStep("properties");
                    else setInviteStep("confirm");
                  }}
                  className="gap-2"
                  disabled={!formData.name || !formData.email}
                >
                  Siguiente Paso
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  className="gradient-gold text-primary-foreground gap-2"
                >
                  {editingMember ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Guardar Cambios
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" /> Enviar Invitación
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de gestión de accesos cíclicos TTLock */}
      {accessDialogMember && (
        <StaffAccessDialog
          open={!!accessDialogMember}
          onOpenChange={(o) => !o && setAccessDialogMember(null)}
          memberId={accessDialogMember.id}
          memberName={accessDialogMember.name}
          properties={savedProperties}
        />
      )}

      {/* Modal: resetear contraseña de un miembro */}
      {resetPasswordMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !resetPasswordSaving && setResetPasswordMember(null)}
        >
          <div
            className="bg-background rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Resetear contraseña</h3>
                <p className="text-xs text-muted-foreground">
                  {resetPasswordMember.name}
                  {resetPasswordMember.loginIdentifier
                    ? ` · ${resetPasswordMember.loginIdentifier}`
                    : ""}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reset-pwd" className="text-sm font-medium">Nueva contraseña</Label>
              <Input
                id="reset-pwd"
                type="text"
                placeholder="Mínimo 6 caracteres"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Después de guardar, copiala y mandasela al miembro por WhatsApp. La clave anterior queda invalidada al instante.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => setResetPasswordMember(null)}
                disabled={resetPasswordSaving}
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  if (resetPasswordValue.length < 6) {
                    alert("La contraseña debe tener al menos 6 caracteres");
                    return;
                  }
                  setResetPasswordSaving(true);
                  try {
                    const res = await fetch(
                      `/api/team-members/${encodeURIComponent(resetPasswordMember.id)}/reset-password`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ password: resetPasswordValue }),
                      }
                    );
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      alert(err.error || "No se pudo resetear la contraseña");
                      return;
                    }
                    // Ofrecer copiar la clave + mandar WhatsApp.
                    const phone = resetPasswordMember.phone.replace(/\D/g, "");
                    const identifier =
                      resetPasswordMember.loginIdentifier ||
                      resetPasswordMember.email ||
                      resetPasswordMember.phone;
                    const msg = encodeURIComponent(
                      `Hola ${resetPasswordMember.name}, tu nueva clave de acceso a StayHost es:\n\nUsuario: ${identifier}\nClave: ${resetPasswordValue}\n\nIngresá en: ${window.location.origin}/acceso`
                    );
                    if (phone && confirm("Contraseña actualizada. ¿Abrir WhatsApp para enviar la nueva clave?")) {
                      window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
                    } else {
                      alert("Contraseña actualizada correctamente.");
                    }
                    setResetPasswordMember(null);
                    setResetPasswordValue("");
                  } catch (e) {
                    console.error(e);
                    alert("Error de red al resetear contraseña");
                  } finally {
                    setResetPasswordSaving(false);
                  }
                }}
                disabled={resetPasswordSaving || resetPasswordValue.length < 6}
              >
                {resetPasswordSaving ? "Guardando..." : "Guardar nueva clave"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
