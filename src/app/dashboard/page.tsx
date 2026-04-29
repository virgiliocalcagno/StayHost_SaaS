"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import OverviewPanel from "@/components/dashboard/OverviewPanel";
import PropertiesPanel from "@/components/dashboard/PropertiesPanel";
import MultiCalendarPanel from "@/components/dashboard/MultiCalendarPanel";
import MessagesPanel from "@/components/dashboard/MessagesPanel";
import CleaningPanel from "@/components/dashboard/CleaningPanel";
import DynamicPricingPanel from "@/components/dashboard/DynamicPricingPanel";
import DirectBookingsPanel from "@/components/dashboard/DirectBookingsPanel";
import SmartDevicesPanel from "@/components/dashboard/SmartDevicesPanel";
import UpsellsPanel from "@/components/dashboard/UpsellsPanel";
import AgreementsPanel from "@/components/dashboard/AgreementsPanel";
import ReviewsPanel from "@/components/dashboard/ReviewsPanel";
import TasksPanel from "@/components/dashboard/TasksPanel";
import TeamPanel from "@/components/dashboard/TeamPanel";
import CheckInsPanel from "@/components/dashboard/CheckInsPanel";
import AccountsPanel from "@/components/dashboard/AccountsPanel";
import KeysPanel from "@/components/dashboard/KeysPanel";
import MaintenancePanel from "@/components/dashboard/MaintenancePanel";
import VendorsPanel from "@/components/dashboard/VendorsPanel";
import ReportsPanel from "@/components/dashboard/ReportsPanel";
import DocumentsPanel from "@/components/dashboard/DocumentsPanel";
import SettingsPanel from "@/components/dashboard/SettingsPanel";
import AdminPanel from "@/components/dashboard/AdminPanel";
import { useModules, ModuleId } from "@/context/ModuleContext";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function DashboardPage() {
  return (
    <Suspense fallback={<div>Cargando Dashboard...</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const { isModuleEnabled, userRole } = useModules();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activePanel, setActivePanel] = useState<PanelType>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // La detección del rol OWNER ahora vive en ModuleContext, leyendo el email
  // autenticado desde Supabase (cookie httpOnly) en vez de localStorage. Así
  // sobrevive a "borrar caché" y no necesita duplicarse aquí.

  // Guardia post-login:
  //   - trial expirado → /pricing-wall
  //   - onboarding pendiente → /onboarding (excepto el Master, que no
  //     necesita el wizard cada vez)
  useEffect(() => {
    fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { trialExpired?: boolean; onboarded?: boolean; isMaster?: boolean } | null) => {
        if (!data) return;
        if (data.trialExpired) {
          router.replace("/pricing-wall");
          return;
        }
        if (!data.onboarded && !data.isMaster) {
          router.replace("/onboarding");
        }
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    const view = searchParams.get("view");
    if (view === "staff") {
      setActivePanel("cleaning");
    }
    // Permite navegar entre paneles via URL (?panel=team, ?panel=properties).
    // Lo usan atajos como "Invitar al equipo" o "Ver propiedades configuradas"
    // desde otros paneles, sin acoplarlos al sidebar.
    const panel = searchParams.get("panel");
    if (panel) {
      const valid: PanelType[] = [
        "overview", "properties", "calendar", "messages", "cleaning",
        "pricing", "bookings", "devices", "upsells", "agreements",
        "reviews", "tasks", "team", "check-ins", "accounts", "keys",
        "maintenance", "vendors", "reports",
      ];
      if ((valid as string[]).includes(panel)) {
        setActivePanel(panel as PanelType);
      }
    }
  }, [searchParams]);

  const renderPanel = () => {
    // Protección para el Portal Admin (SaaS Control)
    if (activePanel === "admin" && userRole !== "OWNER") {
      return (
        <div className="h-[80vh] flex flex-col items-center justify-center space-y-4 animate-in fade-in duration-500">
           <div className="p-6 bg-red-50 rounded-[2.5rem] border border-red-100 shadow-xl shadow-red-500/10">
              <Lock className="h-12 w-12 text-red-500" />
           </div>
           <h2 className="text-3xl font-black text-slate-900 tracking-tight">Acceso Restringido</h2>
           <p className="text-slate-500 font-medium italic">Esta zona está reservada exclusivamente para el <strong>SaaS Master</strong> de StayHost.</p>
           <Button variant="outline" className="rounded-2xl font-bold px-8 mt-4" onClick={() => setActivePanel("overview")}>
              Volver a Seguridad
           </Button>
        </div>
      );
    }

    // Protección para Módulos Desactivados (Lego logic)
    const restrictedPanels: Partial<Record<PanelType, boolean>> = {
      pricing: true,
      bookings: true,
      devices: true,
      upsells: true,
      cleaning: true,
      messages: true,
      "check-ins": true,
    };

    if (restrictedPanels[activePanel] && !isModuleEnabled(activePanel as ModuleId) && userRole !== "OWNER") {
      return (
        <div className="h-[80vh] flex flex-col items-center justify-center space-y-6 animate-in zoom-in duration-500">
           <div className="p-8 bg-amber-50 rounded-[3rem] border border-amber-100 shadow-xl shadow-amber-500/10 relative">
              <div className="absolute top-0 right-0 -mr-2 -mt-2 bg-amber-500 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg">PRO</div>
              <Lock className="h-16 w-16 text-amber-500" />
           </div>
           <div className="text-center space-y-2">
             <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Módulo No Incluido</h2>
             <p className="text-slate-500 font-medium italic max-w-md mx-auto leading-relaxed">
               Este módulo es parte de un paquete superior. Contacta con soporte para activarlo a medida para tu empresa.
             </p>
           </div>
           <Button className="rounded-2xl gradient-gold text-primary-foreground font-black px-12 h-14 shadow-xl shadow-amber-500/20 hover:scale-105 transition-all">
              MEJORAR PLAN AHORA
           </Button>
        </div>
      );
    }

    switch (activePanel) {
      case "overview":
        return <OverviewPanel />;
      case "properties":
        return <PropertiesPanel />;
      case "calendar":
        return <MultiCalendarPanel />;
      case "messages":
        return <MessagesPanel />;
      case "cleaning":
        return <CleaningPanel />;
      case "pricing":
        return <DynamicPricingPanel />;
      case "bookings":
        return <DirectBookingsPanel />;
      case "devices":
        return <SmartDevicesPanel />;
      case "upsells":
        return <UpsellsPanel />;
      case "agreements":
        return <AgreementsPanel />;
      case "reviews":
        return <ReviewsPanel />;
      case "tasks":
        return <TasksPanel />;
      case "team":
        return <TeamPanel />;
      case "check-ins":
        return <CheckInsPanel />;
      case "accounts":
        return <AccountsPanel />;
      case "keys":
        return <KeysPanel />;
      case "maintenance":
        return <MaintenancePanel />;
      case "vendors":
        return <VendorsPanel />;
      case "reports":
        return <ReportsPanel />;
      case "documents":
        return <DocumentsPanel />;
      case "settings":
        return <SettingsPanel />;
      case "admin":
        return <AdminPanel />;
      default:
        return <OverviewPanel />;
    }
  };

  const isStaffMode = searchParams.get("view") === "staff";

  if (isStaffMode) {
    return (
      <main className="min-h-screen bg-background p-0">
        <CleaningPanel />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <DashboardSidebar
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? "md:ml-64" : "md:ml-20"}`}>
        <DashboardHeader
          activePanel={activePanel}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        <main className="flex-1 p-6 overflow-auto">
          {renderPanel()}
        </main>
      </div>
    </div>
  );
}
