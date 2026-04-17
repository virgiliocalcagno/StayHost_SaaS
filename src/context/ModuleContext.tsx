"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

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
  growth: ["properties", "calendar", "bookings", "accounts", "messages", "cleaning", "pricing", "reports"],
  master: [
    "properties", "calendar", "bookings", "accounts", "messages",
    "cleaning", "pricing", "reports", "devices", "upsells",
    "agreements", "team", "check-ins", "keys", "documents",
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
  { id: "documents",  name: "Documentos",            description: "Almacenamiento de contratos y archivos.",          version: "1.0", category: "compliance",    planTier: "master",  enabled: true, builtIn: true, icon: "Folder" },
];

const DEFAULT_MODULES: Record<ModuleId, boolean> = {
  properties: true, calendar: true, messages: true, cleaning: true,
  pricing: true, bookings: true, devices: true, upsells: true,
  agreements: true, team: true, "check-ins": true, accounts: true,
  keys: true, reports: true, documents: true,
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<Record<ModuleId, boolean>>(DEFAULT_MODULES);
  const [userRole, setUserRole] = useState<"OWNER" | "ADMIN" | "STAFF" | null>(null);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [previewPlan, setPreviewPlan] = useState<"starter" | "growth" | "master" | null>(null);

  const syncSession = () => {
    try {
      const session = localStorage.getItem("stayhost_session");
      if (session) {
        const parsed = JSON.parse(session);
        setUserRole(parsed.email === "virgiliocalcagno@gmail.com" ? "OWNER" : parsed.role);
      } else {
        setUserRole(null);
      }
    } catch {}

    try {
      const saved = localStorage.getItem("stayhost_modules_config");
      if (saved) setModules(JSON.parse(saved));
    } catch {}

    try {
      const saved = localStorage.getItem("stayhost_plugin_registry");
      if (saved) setPlugins(JSON.parse(saved));
    } catch {}
  };

  useEffect(() => {
    syncSession();
    window.addEventListener("storage", syncSession);
    const interval = setInterval(syncSession, 1000);
    const timeout = setTimeout(() => clearInterval(interval), 10000);
    return () => {
      window.removeEventListener("storage", syncSession);
      clearInterval(interval);
      clearTimeout(timeout);
    };
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
