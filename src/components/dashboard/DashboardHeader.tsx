"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, Search, Menu, Plus, ChevronDown, Clock } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { logoutAndRedirect } from "@/lib/auth/logout";

const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

type PanelType =
  | "overview"
  | "properties"
  | "calendar"
  | "messages"
  | "cleaning"
  | "pricing"
  | "bookings"
  | "devices"
  | "upsells"
  | "agreements"
  | "reviews"
  | "tasks"
  | "team"
  | "check-ins"
  | "accounts"
  | "keys"
  | "maintenance"
  | "vendors"
  | "reports"
  | "documents"
  | "settings"
  | "admin";

interface HeaderProps {
  activePanel: PanelType;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const panelTitles: Record<PanelType, string> = {
  overview: "Vista General",
  properties: "Propiedades",
  calendar: "Multi-calendario",
  messages: "Mensajes IA",
  cleaning: "Limpieza",
  pricing: "Precios Dinamicos",
  bookings: "Reservas Directas",
  devices: "Dispositivos Inteligentes",
  upsells: "Ventas Adicionales",
  agreements: "Acuerdos de Alquiler",
  reviews: "Reseñas",
  tasks: "Tareas",
  team: "Miembros del Equipo",
  "check-ins": "Check-ins",
  accounts: "Cuentas y Listados",
  keys: "Llaves",
  maintenance: "Mantenimiento",
  vendors: "Proveedores",
  reports: "Reportes",
  documents: "Documentos",
  settings: "Configuración",
  admin: "Admin",
};

export default function DashboardHeader({ activePanel, sidebarOpen, setSidebarOpen }: HeaderProps) {
  // Mostramos el primer nombre del usuario autenticado; si es el master,
  // "Virgilio". Si no hay sesión aún, el saludo se oculta para no mostrar
  // un nombre hardcoded (antes decía "Juan"). Tambien agarramos
  // planExpiresAt e isMaster para mostrar el banner de trial.
  const [firstName, setFirstName] = useState<string | null>(null);
  const [planExpiresAt, setPlanExpiresAt] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [isMaster, setIsMaster] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const resolveName = (emailRaw: string | null | undefined) => {
      const email = String(emailRaw ?? "").trim().toLowerCase();
      if (!email) return null;
      if (email === MASTER_EMAIL) return "Virgilio";
      return email.split("@")[0];
    };
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store", credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as {
            email: string | null;
            planExpiresAt: string | null;
            plan: string | null;
            isMaster: boolean;
          };
          if (!cancelled && data.email) {
            setFirstName(resolveName(data.email));
            setPlanExpiresAt(data.planExpiresAt ?? null);
            setPlan(data.plan ?? null);
            setIsMaster(!!data.isMaster);
            return;
          }
        }
      } catch {}
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setFirstName(resolveName(data.user?.email));
      } catch {
        if (!cancelled) setFirstName(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Banner de trial: solo visible si plan='trial' y queda fecha. Master
  // no lo necesita (no expira). Color escala con urgencia.
  const trialBanner = (() => {
    if (isMaster) return null;
    if (plan !== "trial" || !planExpiresAt) return null;
    const ms = new Date(planExpiresAt).getTime() - Date.now();
    if (ms <= 0) return null; // expirado, dashboard ya redirige a /pricing-wall
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    let cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (days <= 3) cls = "bg-red-50 text-red-700 border-red-200";
    else if (days <= 7) cls = "bg-amber-50 text-amber-700 border-amber-200";
    return { days, cls };
  })();

  return (
    <header className="h-16 bg-card border-b flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div>
          <h1 className="text-xl font-bold">{panelTitles[activePanel]}</h1>
          {firstName && (
            <p className="text-sm text-muted-foreground hidden sm:block">
              Bienvenido de nuevo, {firstName}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Trial banner — visible solo para tenants en trial activo */}
        {trialBanner && (
          <Link
            href="/pricing-wall"
            className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${trialBanner.cls}`}
          >
            <Clock className="h-3.5 w-3.5" />
            {trialBanner.days === 1
              ? "Te queda 1 día de prueba"
              : `Te quedan ${trialBanner.days} días de prueba`}
          </Link>
        )}

        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="pl-9 w-64 bg-muted/50 border-0"
          />
        </div>

        {/* Quick Add */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gradient-gold text-primary-foreground gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Nueva Propiedad</DropdownMenuItem>
            <DropdownMenuItem>Nueva Reserva</DropdownMenuItem>
            <DropdownMenuItem>Nuevo Mensaje</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Nueva Tarea de Limpieza</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center gradient-gold text-primary-foreground text-xs">
            3
          </Badge>
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop" />
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
              <ChevronDown className="h-4 w-4 hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Mi Perfil</DropdownMenuItem>
            <DropdownMenuItem>Configuracion</DropdownMenuItem>
            <DropdownMenuItem>Facturacion</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                window.location.assign("/salir");
              }}
            >
              Cerrar Sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
