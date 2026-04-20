"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

// Email del SaaS Master — quien esté autenticado con este email entra como
// OWNER aun cuando localStorage esté vacío (por ejemplo después de borrar
// caché). Lo leemos del auth de Supabase, que sí sobrevive al clear-cache
// del navegador (cookie httpOnly).
const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

// ─── Core module IDs (built-in) ───────────────────────────────────────────────
export type ModuleId =
  | "properties"
  | "calendar"
  | "messages"
  | "cleaning"
  | "pricing"
  | "bookings"
  | "devices"
  | "upsells"
  | "agreements"
  | "team"
  | "check-ins"
  | "accounts"
  | "keys"
  | "maintenance"
  | "reports"
  | "documents";

// ─── Plugin Manifest — for future add-on modules ─────────────────────────────
// To add a new plugin without touching existing code:
//   1. Create the panel component in src/components/dashboard/
//   2. Register it in localStorage under "stayhost_plugin_registry"
//   3. Add a case in dashboard/page.tsx renderPanel()
//   4. The sidebar and admin panel pick it up automatically
export interface PluginManifest {
  id: string;               // unique slug, e.g. "revenue-analytics"
  name: string;
  description: string;
  version: string;
  category: "operations" | "revenue" | "integrations" | "ai" | "compliance";
  planTier: "starter" | "growth" | "master" | "addon";
  addonPrice?: number;      // USD/mo if planTier === "addon"
  enabled: boolean;
  builtIn: boolean;         // false = dynamically registered plugin
  icon?: string;            // lucide icon name
}

interface ModuleContextType {
  modules: Record<ModuleId, boolean>;
  toggleModule: (id: ModuleId) => void;
  isModuleEnabled: (id: ModuleId | string) => boolean;
  applyPlan: (planId: "starter" | "growth" | "master") => void;
  userRole: "OWNER" | "ADMIN" | "STAFF" | null;
  setUserRole: (role: "OWNER" | "ADMIN" | "STAFF" | null) => void;
  // Plugin registry
  plugins: PluginManifest[];
  registerPlugin: (manifest: PluginManifest) => void;
  unregisterPlugin: (id: string) => void;
  togglePlugin: (id: string) => void;
  // Tenant preview: simulate what a plan-X customer sees
  previewPlan: "starter" | "growth" | "master" | null;
  setPreviewPlan: (plan: "starter" | "growth" | "master" | null) => void;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

// ─── Plan definitions ─────────────────────────────────────────────────────────
export const SAAS_PLANS: Record<string, ModuleId[]> = {
  starter: ["properties", "calendar", "bookings", "accounts"],
  growth: ["properties", "calendar", "bookings", "accounts", "messages", "cleaning", "pricing", "reports", "maintenance"],
  master: [
    "properties", "calendar", "bookings", "accounts", "messages",
    "cleaning", "pricing", "reports", "devices", "upsells",
    "agreements", "team", "check-ins", "keys", "maintenance", "documents",
  ],
};

export const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  growth: 79,
  master: 179,
};

// ─── Built-in module metadata (used by Admin plugin registry view) ────────────
export const BUILTIN_PLUGINS: PluginManifest[] = [
  { id: "properties",  name: "Propiedades",         description: "Gestión de unidades, imágenes y configuración.",   version: "1.0", category: "operations",    planTier: "starter", enabled: true, builtIn: true, icon: "Building2" },
  { id: "calendar",    name: "Multi-Calendario",     description: "Vista unificada de todas las reservas.",           version: "1.0", category: "operations",    planTier: "starter", enabled: true, builtIn: true, icon: "Calendar" },
  { id: "bookings",    name: "Reservas Directas",    description: "Hub de reservas sin comisiones OTA.",              version: "1.0", category: "revenue",       planTier: "starter", enabled: true, builtIn: true, icon: "Globe" },
  { id: "accounts",   name: "Cuentas & Listados",   description: "Vinculación de canales externos.",                  version: "1.0", category: "integrations",  planTier: "starter", enabled: true, builtIn: true, icon: "User" },
  { id: "messages",   name: "Mensajes IA",           description: "Respuestas automáticas con IA para huéspedes.",    version: "1.0", category: "ai",            planTier: "growth",  enabled: true, builtIn: true, icon: "MessageSquare" },
  { id: "cleaning",   name: "Operaciones / Limpieza", description: "Portal de staff, checklists y QA fotográfico.", version: "2.0", category: "operations",    planTier: "growth",  enabled: true, builtIn: true, icon: "Sparkles" },
  { id: "pricing",    name: "Precios Dinámicos",     description: "Ajuste automático de tarifas por demanda.",        version: "1.0", category: "revenue",       planTier: "growth",  enabled: true, builtIn: true, icon: "TrendingUp" },
  { id: "reports",    name: "Reportes",              description: "Análisis de ingresos, ocupación y tendencias.",    version: "1.0", category: "revenue",       planTier: "growth",  enabled: true, builtIn: true, icon: "BarChart2" },
  { id: "devices",    name: "Dispositivos IoT",      description: "Cerraduras TTLock, termostatos, sensores.",        version: "1.0", category: "integrations",  planTier: "master",  enabled: true, builtIn: true, icon: "Smartphone" },
  { id: "upsells",    name: "Ventas Adicionales",    description: "Ofrece servicios extras a huéspedes.",             version: "1.0", category: "revenue",       planTier: "master",  enabled: true, builtIn: true, icon: "ShoppingCart" },
  { id: "agreements", name: "Acuerdos de Alquiler",  description: "Contratos digitales con firma electrónica.",       version: "1.0", category: "compliance",    planTier: "master",  enabled: true, builtIn: true, icon: "ClipboardCheck" },
  { id: "team",       name: "Equipo",                description: "Roles, permisos y gestión de personal.",          version: "1.0", category: "operations",    planTier: "master",  enabled: true, builtIn: true, icon: "Users" },
  { id: "check-ins",  name: "Check-ins Digitales",   description: "Verificación de identidad y acceso QR.",          version: "2.0", category: "operations",    planTier: "master",  enabled: true, builtIn: true, icon: "LogIn" },
  { id: "keys",       name: "Llaves",                description: "Gestión de llaves físicas y códigos.",             version: "1.0", category: "operations",    planTier: "master",  enabled: true, builtIn: true, icon: "Key" },
  { id: "maintenance", name: "Mantenimiento",        description: "Tickets de daños y averías, independientes de limpieza.", version: "1.0", category: "operations", planTier: "growth", enabled: true, builtIn: true, icon: "Wrench" },
  { id: "documents",  name: "Documentos",            description: "Almacenamiento de contratos y archivos.",          version: "1.0", category: "compliance",    planTier: "master",  enabled: true, builtIn: true, icon: "Folder" },
];

const DEFAULT_MODULES: Record<ModuleId, boolean> = {
  properties: true, calendar: true, messages: true, cleaning: true,
  pricing: true, bookings: true, devices: true, upsells: true,
  agreements: true, team: true, "check-ins": true, accounts: true,
  keys: true, maintenance: true, reports: true, documents: true,
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<Record<ModuleId, boolean>>(DEFAULT_MODULES);
  const [userRole, setUserRole] = useState<"OWNER" | "ADMIN" | "STAFF" | null>(null);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [previewPlan, setPreviewPlan] = useState<"starter" | "growth" | "master" | null>(null);

  // Fuente de verdad del rol: Supabase auth. Si el email autenticado es el
  // master, somos OWNER; si hay otro usuario autenticado, tratamos el rol
  // legacy de localStorage como fallback (ADMIN/STAFF); si no hay sesión,
  // userRole es null.
  const applyRoleFromAuthEmail = (email: string | null | undefined) => {
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (normalizedEmail === MASTER_EMAIL) {
      setUserRole("OWNER");
      // Sincronizamos localStorage para que componentes legacy que siguen
      // leyendo `stayhost_session` directo también vean OWNER.
      try {
        const existing = localStorage.getItem("stayhost_session");
        const parsed = existing ? JSON.parse(existing) : {};
        if (parsed.role !== "OWNER" || parsed.email !== normalizedEmail) {
          localStorage.setItem(
            "stayhost_session",
            JSON.stringify({ ...parsed, email: normalizedEmail, role: "OWNER" })
          );
        }
        localStorage.setItem("stayhost_owner_email", normalizedEmail);
      } catch {}
      return;
    }
    // Usuario autenticado pero no master — usamos el rol guardado (si existe).
    try {
      const session = localStorage.getItem("stayhost_session");
      if (session) {
        const parsed = JSON.parse(session);
        setUserRole(parsed.role ?? null);
      } else {
        setUserRole(null);
      }
    } catch {
      setUserRole(null);
    }
  };

  const syncSession = async () => {
    // 1) Rol real desde el servidor — leemos /api/me que a su vez lee la
    //    cookie httpOnly. Esto es más fiable que supabase.auth.getUser() en el
    //    browser, que a veces no ve la cookie (incógnito, caché borrada, etc.).
    let sawServerSession = false;
    try {
      const res = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { email: string | null; isMaster: boolean };
        if (data.email) {
          sawServerSession = true;
          applyRoleFromAuthEmail(data.email);
        }
      }
    } catch {
      // Cae al segundo intento abajo.
    }

    // 2) Si /api/me no dio sesión, probamos el cliente Supabase (por si el
    //    servidor aún no escribió la cookie pero el cliente sí tiene el token).
    if (!sawServerSession) {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user?.email) {
          sawServerSession = true;
          applyRoleFromAuthEmail(data.user.email);
        }
      } catch {}
    }

    // 3) Último fallback: legacy localStorage.
    if (!sawServerSession) {
      try {
        const session = localStorage.getItem("stayhost_session");
        if (session) {
          const parsed = JSON.parse(session);
          const normalized = String(parsed.email ?? "").trim().toLowerCase();
          setUserRole(normalized === MASTER_EMAIL ? "OWNER" : (parsed.role ?? null));
        } else {
          setUserRole(null);
        }
      } catch {
        setUserRole(null);
      }
    }

    // 2) Config de módulos y plugins — se mantienen en localStorage.
    try {
      const saved = localStorage.getItem("stayhost_modules_config");
      if (saved) {
        // Merge con DEFAULT_MODULES: módulos nuevos agregados en código
        // heredan su default (normalmente true) sin requerir que el usuario
        // limpie localStorage.
        setModules({ ...DEFAULT_MODULES, ...JSON.parse(saved) });
      }
    } catch {}
    try {
      const saved = localStorage.getItem("stayhost_plugin_registry");
      if (saved) setPlugins(JSON.parse(saved));
    } catch {}
  };

  useEffect(() => {
    syncSession();

    // Re-evaluar cuando Supabase emita eventos de auth (login, logout, refresh).
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      applyRoleFromAuthEmail(session?.user?.email);
    });

    // También re-evaluamos si otra pestaña cambia el localStorage.
    const onStorage = () => { void syncSession(); };
    window.addEventListener("storage", onStorage);

    return () => {
      authListener.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleModule = (id: ModuleId) => {
    setModules(prev => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("stayhost_modules_config", JSON.stringify(next));
      return next;
    });
  };

  const applyPlan = (planId: "starter" | "growth" | "master") => {
    const planModules = SAAS_PLANS[planId];
    const next = {} as Record<ModuleId, boolean>;
    Object.keys(DEFAULT_MODULES).forEach(k => { next[k as ModuleId] = false; });
    planModules.forEach(id => { next[id] = true; });
    setModules(next);
    localStorage.setItem("stayhost_modules_config", JSON.stringify(next));
  };

  const isModuleEnabled = (id: ModuleId | string) => {
    if (id in modules) return modules[id as ModuleId] ?? false;
    const plugin = plugins.find(p => p.id === id);
    return plugin?.enabled ?? false;
  };

  const registerPlugin = (manifest: PluginManifest) => {
    setPlugins(prev => {
      const next = [...prev.filter(p => p.id !== manifest.id), manifest];
      localStorage.setItem("stayhost_plugin_registry", JSON.stringify(next));
      return next;
    });
  };

  const unregisterPlugin = (id: string) => {
    setPlugins(prev => {
      const next = prev.filter(p => p.id !== id);
      localStorage.setItem("stayhost_plugin_registry", JSON.stringify(next));
      return next;
    });
  };

  const togglePlugin = (id: string) => {
    setPlugins(prev => {
      const next = prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
      localStorage.setItem("stayhost_plugin_registry", JSON.stringify(next));
      return next;
    });
  };

  return (
    <ModuleContext.Provider value={{
      modules, toggleModule, isModuleEnabled, applyPlan,
      userRole, setUserRole,
      plugins, registerPlugin, unregisterPlugin, togglePlugin,
      previewPlan, setPreviewPlan,
    }}>
      {children}
    </ModuleContext.Provider>
  );
}

export function useModules() {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error("useModules must be used within a ModuleProvider");
  return ctx;
}
