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
import { Bell, Search, Menu, Plus, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

const MASTER_EMAIL = "virgiliocalcagno@gmail.com";

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
  reports: "Reportes",
  documents: "Documentos",
  settings: "Configuración",
  admin: "Admin",
};

export default function DashboardHeader({ activePanel, sidebarOpen, setSidebarOpen }: HeaderProps) {
  // Mostramos el primer nombre del usuario autenticado; si es el master,
  // "Virgilio". Si no hay sesión aún, el saludo se oculta para no mostrar
  // un nombre hardcoded (antes decía "Juan").
  const [firstName, setFirstName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const resolveName = (emailRaw: string | null | undefined) => {
      const email = String(emailRaw ?? "").trim().toLowerCase();
      if (!email) return null;
      if (email === MASTER_EMAIL) return "Virgilio";
      return email.split("@")[0];
    };
    (async () => {
      // Preferimos /api/me (cookie del servidor) sobre el SDK del browser.
      try {
        const res = await fetch("/api/me", { cache: "no-store", credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { email: string | null };
          if (!cancelled && data.email) {
            setFirstName(resolveName(data.email));
            return;
          }
        }
      } catch {}
      // Fallback al SDK.
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setFirstName(resolveName(data.user?.email));
      } catch {
        if (!cancelled) setFirstName(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
            <DropdownMenuItem className="text-destructive">Cerrar Sesion</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
