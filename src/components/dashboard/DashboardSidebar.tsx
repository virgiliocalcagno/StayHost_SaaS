"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Home,
  LayoutDashboard,
  Building2,
  Calendar,
  MessageSquare,
  Sparkles,
  Settings,
  HelpCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Globe,
  Smartphone,
  ShoppingCart,
  ClipboardCheck,
  Star,
  Users,
  LogIn,
  User,
  Key,
  BarChart2,
  Folder,
  ShieldCheck,
  ChevronDown,
  Zap,
} from "lucide-react";

import { useModules, ModuleId } from "@/context/ModuleContext";

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

interface SidebarProps {
  activePanel: PanelType;
  setActivePanel: (panel: PanelType) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const mainMenuItems = [
  { id: "overview", label: "Vista General", icon: LayoutDashboard },
  { id: "properties", label: "Propiedades", icon: Building2 },
  { id: "calendar", label: "Multi-calendario", icon: Calendar },
  { id: "messages", label: "Mensajes IA", icon: MessageSquare },
  { id: "cleaning", label: "Limpieza", icon: Sparkles },
];

const modulesMenuItems = [
  { id: "pricing", label: "Precios Dinamicos", icon: TrendingUp },
  { id: "bookings", label: "Reservas Directas", icon: Globe },
  { id: "devices", label: "Dispositivos", icon: Smartphone },
  { id: "upsells", label: "Ventas Extras", icon: ShoppingCart },
  { id: "agreements", label: "Acuerdos", icon: ClipboardCheck },
  { id: "team", label: "Equipo", icon: Users },
  { id: "check-ins", label: "Check-ins", icon: LogIn },
  { id: "accounts", label: "Cuentas", icon: User },
  { id: "keys", label: "Llaves", icon: Key },
  { id: "reports", label: "Reportes", icon: BarChart2 },
  { id: "documents", label: "Documentos", icon: Folder },
];

export default function DashboardSidebar({
  activePanel,
  setActivePanel,
  sidebarOpen,
  setSidebarOpen,
}: SidebarProps) {
  const { isModuleEnabled, userRole } = useModules();

  const filteredMainItems = mainMenuItems.filter(item => 
    item.id === "overview" || isModuleEnabled(item.id as ModuleId)
  );

  const filteredModuleItems = modulesMenuItems.filter(item => 
    isModuleEnabled(item.id as ModuleId)
  );
  const renderMenuItem = (item: { id: string; label: string; icon: React.ElementType }) => {
    const isActive = activePanel === item.id;
    const menuButton = (
      <Button
        key={item.id}
        variant={isActive ? "secondary" : "ghost"}
        className={`w-full justify-start gap-3 ${
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
        } ${!sidebarOpen && "justify-center px-2"}`}
        onClick={() => setActivePanel(item.id as PanelType)}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {sidebarOpen && <span className="truncate">{item.label}</span>}
      </Button>
    );

    if (!sidebarOpen) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>{menuButton}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      );
    }

    return menuButton;
  };

  return (
    <TooltipProvider>
      <aside
        className={`fixed left-0 top-0 h-full bg-card border-r z-40 transition-all duration-300 flex flex-col ${
          sidebarOpen ? "w-64" : "w-20"
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-gold shrink-0">
              <Home className="h-5 w-5 text-primary-foreground" />
            </div>
            {sidebarOpen && (
              <span className="text-xl font-bold text-foreground">
                Stay<span className="text-primary">Host</span>
              </span>
            )}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden md:flex shrink-0"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="p-4 space-y-1">
            {/* Main Menu */}
            {sidebarOpen && (
              <p className="text-xs font-medium text-muted-foreground mb-2 px-2">Principal</p>
            )}
            {filteredMainItems.map(renderMenuItem)}

            {/* Separator */}
            <Separator className="my-4" />

            {/* Modules Menu */}
            {sidebarOpen && filteredModuleItems.length > 0 && (
              <p className="text-xs font-medium text-muted-foreground mb-2 px-2">Modulos</p>
            )}
            {filteredModuleItems.map(renderMenuItem)}
            
          </nav>
        </ScrollArea>

        {/* SaaS Control - Fijo, siempre visible para el Master */}
        {userRole === "OWNER" && (
          <div className="shrink-0 px-4 py-3 border-t border-amber-100 bg-gradient-to-r from-amber-50/80 to-white">
            {sidebarOpen && <p className="px-2 mb-1.5 text-[10px] font-black text-amber-500 uppercase tracking-[0.2em]">⚡ Master</p>}
            {renderMenuItem({ id: "admin", label: "SaaS Control", icon: Zap })}
          </div>
        )}

        {/* Bottom Section */}
        <div className="p-4 border-t space-y-2 shrink-0">
          {sidebarOpen ? (
            <>
              <Button 
                variant="ghost" 
                className={`w-full justify-start gap-3 ${activePanel === "settings" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                onClick={() => setActivePanel("settings")}
              >
                <Settings className="h-5 w-5" />
                Configuracion
              </Button>
              <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground">
                <HelpCircle className="h-5 w-5" />
                Ayuda
              </Button>
            </>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className={`w-full ${activePanel === "settings" ? "bg-primary/10 text-primary" : ""}`}
                    onClick={() => setActivePanel("settings")}
                  >
                    <Settings className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Configuracion</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-full">
                    <HelpCircle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Ayuda</TooltipContent>
              </Tooltip>
            </>
          )}

          {/* User Profile */}
          <div className={`flex items-center gap-3 p-2 rounded-lg bg-muted/50 ${!sidebarOpen && "justify-center"}`}>
            <Avatar className="h-8 w-8">
              <AvatarImage src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop" />
              <AvatarFallback>V</AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{userRole === "OWNER" ? "Virgilio" : "Usuario"}</p>
                <p className="text-xs text-amber-500 font-bold truncate">
                   {userRole === "OWNER" ? "👑 SaaS Master" : (userRole || "Staff")}
                </p>
              </div>
            )}
            {sidebarOpen && (
              <Button variant="ghost" size="icon" className="shrink-0" asChild>
                <Link href="/">
                  <LogOut className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
