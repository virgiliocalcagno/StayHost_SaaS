"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  MessageSquare, 
  Sparkles, 
  Store, 
  CalendarDays, 
  BarChart3, 
  ArrowRight, 
  ShieldCheck,
  CheckCircle2,
  Users2,
  LayoutDashboard
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: MessageSquare,
    title: "Bandeja Unificada Inteligente",
    description: "Centraliza todas tus conversaciones de Airbnb, Booking.com y Reservas Directas en un solo lugar. Responde en segundos con ayuda de nuestra IA.",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    image: (
      <div className="bg-white rounded-3xl p-4 border border-slate-100 shadow-xl group-hover:scale-105 transition-transform duration-500">
        <div className="space-y-3">
          <div className="flex gap-2 items-center p-2 rounded-xl bg-slate-50 border border-slate-100/50">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-black text-[8px]">Ab</div>
            <div className="flex-1 h-3 bg-slate-200 rounded-full" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
          </div>
          <div className="flex gap-2 items-center p-2 rounded-xl bg-blue-50/50 border border-blue-100">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-black text-[8px]">Bk</div>
            <div className="flex-1 space-y-1">
              <div className="h-3 w-full bg-blue-200/50 rounded-full" />
              <div className="h-2 w-2/3 bg-blue-100/50 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Store,
    title: "Motor de Reservas Directas",
    description: "Tu propia web de reservas profesional conectada a Stripe y PayPal. Genera más margen eliminando las comisiones de las grandes plataformas.",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    image: (
      <div className="bg-white rounded-3xl p-4 border border-slate-100 shadow-xl group-hover:scale-105 transition-transform duration-500 relative">
        <div className="h-32 w-full rounded-2xl bg-amber-50 overflow-hidden relative border border-amber-100/50">
           <img src="https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=400&q=80" className="w-full h-full object-cover opacity-60" alt="Reserva Directa" />
           <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
           <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center bg-white/90 backdrop-blur-sm p-2 rounded-xl shadow-sm border border-amber-100">
              <span className="text-[9px] font-black text-slate-900 tracking-tighter uppercase">Total Pagado</span>
              <span className="text-[9px] font-black text-amber-600">$406.00</span>
           </div>
        </div>
      </div>
    ),
  },
  {
    icon: Users2,
    title: "Gestión de Staff y Limpieza",
    description: "Automatiza la asignación de tareas a tu equipo. Envío de checklists, evidencia fotográfica y estados en tiempo real al finalizar cada estancia.",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    image: (
      <div className="bg-white rounded-3xl p-4 border border-slate-100 shadow-xl group-hover:scale-105 transition-transform duration-500">
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-xl border border-slate-50 bg-slate-50/50">
              <div className={cn("w-4 h-4 rounded border-2 flex items-center justify-center", i === 1 ? "bg-emerald-500 border-emerald-500" : "border-slate-200")}>
                {i === 1 && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
              <div className={cn("h-2 rounded-full bg-slate-200", i === 1 ? "w-20 opacity-40" : "w-24")} />
            </div>
          ))}
          <div className="pt-2 flex justify-between items-center">
            <div className="flex -space-x-2">
              {[1, 2, 3].map(p => <div key={p} className="w-6 h-6 rounded-full border-2 border-white bg-slate-200" />)}
            </div>
            <span className="text-[10px] font-bold text-emerald-600">80% Completado</span>
          </div>
        </div>
      </div>
    ),
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 lg:py-32 bg-white relative">
      {/* Soft Decorative Gradients */}
      <div className="absolute top-0 right-0 w-1/3 h-1/4 bg-amber-50/50 blur-[120px] rounded-full -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-1/3 h-1/4 bg-blue-50/50 blur-[120px] rounded-full -ml-20 -mb-20" />

      <div className="container px-6 mx-auto relative z-10">
        <div className="text-center mb-24 max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 text-amber-600 text-[11px] font-black uppercase tracking-[0.2em] mb-6 border border-amber-100/50 shadow-sm">
             <Sparkles className="h-3 w-3" /> All-In-One PMS Elite
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-5xl font-extrabold text-[#1e293b] leading-[1.15] mb-8">
            Diseñado para dominar el <span className="text-amber-500">mercado vacacional</span>
          </h2>
          <p className="text-xl text-slate-500 font-medium leading-relaxed">
            StayHost unifica tus canales, tus pagos y tu equipo en una sola interfaz limpia y potente. Gestión profesional sin complicaciones.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          {features.map((feature) => (
            <div key={feature.title} className="group relative">
              <div className="absolute -inset-4 bg-slate-50/50 rounded-[40px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative space-y-8">
                 <div className="mb-10 p-2">
                   {feature.image}
                 </div>

                 <div className="space-y-4 px-2">
                   <div className={cn(
                     "w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transform group-hover:-translate-y-1 transition-all duration-300",
                     feature.bgColor
                   )}>
                     <feature.icon className={cn("h-6 w-6", feature.color)} />
                   </div>
                   
                   <h3 className="text-2xl font-bold text-[#1e293b] tracking-tight">
                     {feature.title}
                   </h3>
                   
                   <p className="text-slate-500 leading-relaxed font-medium">
                     {feature.description}
                   </p>

                   <ul className="space-y-3 pt-4">
                     {[1, 2].map((_, i) => (
                       <li key={i} className="flex items-center gap-3 text-sm text-slate-400 font-semibold group-hover:text-slate-600 transition-colors">
                          <CheckCircle2 className={cn("h-4 w-4 shrink-0", feature.color)} />
                          {feature.title.includes("Bandeja") && (i === 0 ? "Respuestas con IA" : "Historial unificado")}
                          {feature.title.includes("Motor") && (i === 0 ? "Checkout en 1 clic" : "Stripe & PayPal ready")}
                          {feature.title.includes("Staff") && (i === 0 ? "Checklists automáticos" : "Evidencia fotográfica")}
                       </li>
                     ))}
                   </ul>
                 </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-24 text-center">
           <Button size="lg" className="h-16 px-10 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black text-lg gap-3 shadow-xl shadow-amber-500/20 group border-none">
              <Link href="/dashboard" className="flex items-center gap-3">
                 PROBAR STAYHOST GRATIS
                 <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
           </Button>
           <div className="mt-8 flex items-center justify-center gap-6 grayscale opacity-40">
              <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/Airbnb_Logo_Bélo.svg" className="h-5" alt="Airbnb" />
              <img src="https://upload.wikimedia.org/wikipedia/commons/b/be/Booking.com_logo.svg" className="h-4" alt="Booking" />
              <img src="https://upload.wikimedia.org/wikipedia/commons/e/e1/Expedia_2023_logo.svg" className="h-4" alt="Expedia" />
           </div>
        </div>
      </div>
    </section>
  );
}
