"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ArrowRight, 
  Globe, 
  MessageSquare, 
  Calendar, 
  ShieldCheck,
  Zap,
  Star
} from "lucide-react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");

  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-white">
      
      {/* ── LEFT SIDE: Form ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col p-8 md:p-16 lg:p-24 max-w-2xl mx-auto md:mx-0">
        <div className="mb-12">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:rotate-6 transition-transform">
              <span className="text-white font-black text-xl italic">S</span>
            </div>
            <span className="text-2xl font-black text-slate-900 tracking-tighter">StayHost</span>
          </Link>
        </div>

        <div className="space-y-8 flex-1 flex flex-col justify-center">
          <div className="space-y-3">
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Comienza tu prueba <span className="text-amber-500">gratuita</span> abajo
            </h1>
            <p className="text-slate-500 font-medium italic">
              Ya tienes una cuenta? <Link href="/login" className="text-amber-600 font-bold hover:underline">Iniciar sesión</Link>
            </p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-slate-400">Correo electrónico:</Label>
              <Input 
                id="email"
                type="email" 
                placeholder="tu@email.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 rounded-xl border-slate-200 focus:ring-amber-500/20 text-lg"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox id="updates" className="mt-1 border-slate-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
                <Label htmlFor="updates" className="text-xs text-slate-500 leading-relaxed font-medium">
                  Recibe consejos, actualizaciones de producto y ofertas exclusivas de StayHost por correo electrónico y mensaje de texto. Cancela en cualquier momento. <span className="text-slate-300 italic">(opcional)</span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox id="terms" required className="mt-1 border-slate-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
                <Label htmlFor="terms" className="text-xs text-slate-500 leading-relaxed font-medium">
                  Acepto los <Link href="#" className="text-amber-500 underline">Términos y Condiciones</Link> y la <Link href="#" className="text-amber-500 underline">Política de Privacidad</Link> *
                </Label>
              </div>
            </div>

            <Button className="w-full h-14 bg-amber-500 hover:bg-amber-600 text-white font-black text-lg rounded-xl shadow-xl shadow-amber-500/20 border-none group">
              Continuar
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
              <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-300 bg-white px-4">O regístrate con</div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Button variant="outline" className="h-14 rounded-xl border-slate-200 hover:bg-slate-50 gap-3 font-bold text-slate-700">
                <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/Airbnb_Logo_Bélo.svg" className="h-5" alt="Airbnb" />
                Continuar con Airbnb
              </Button>
              <Button variant="outline" className="h-14 rounded-xl border-slate-200 hover:bg-slate-50 gap-3 font-bold text-slate-700">
                <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" className="h-5" alt="Google" />
                Continuar con Google
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-12 text-[10px] text-slate-300 font-bold uppercase tracking-widest flex justify-between items-center">
          <span>© 2024–2026 StayHost Inc.</span>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-slate-500">Seguridad</Link>
            <Link href="#" className="hover:text-slate-500">Soporte</Link>
          </div>
        </div>
      </div>

      {/* ── RIGHT SIDE: Preview / Social Proof ──────────────────────────────── */}
      <div className="hidden lg:flex flex-1 bg-slate-50 relative overflow-hidden items-center justify-center p-24">
        {/* Decorative background */}
        <div className="absolute top-0 right-0 w-full h-full opacity-[0.03] pointer-events-none">
          <div className="absolute translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-amber-500 blur-3xl" />
        </div>

        <div className="relative z-10 w-full max-w-2xl space-y-12">
          <div className="bg-white rounded-[40px] shadow-2xl border border-slate-200/50 p-8 transform rotate-2 hover:rotate-0 transition-transform duration-700 relative group">
            <div className="absolute -top-4 -right-4 bg-amber-500 text-white p-4 rounded-3xl shadow-xl flex items-center gap-2 font-black text-sm z-20">
              <Star className="h-4 w-4 fill-white" /> #1 PMS Elite
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 animate-pulse" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-32 bg-slate-200 rounded-full" />
                    <div className="h-2 w-20 bg-slate-100 rounded-full" />
                  </div>
                </div>
                <div className="flex -space-x-3">
                   {[1, 2, 3].map(i => <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-slate-200 shadow-sm" />)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="h-32 rounded-3xl bg-amber-50/50 border border-amber-100/50 p-4 flex flex-col justify-between">
                   <Calendar className="h-5 w-5 text-amber-500" />
                   <div className="h-2 w-full bg-amber-200/50 rounded-full" />
                </div>
                <div className="h-32 rounded-3xl bg-blue-50/50 border border-blue-100/50 p-4 flex flex-col justify-between">
                   <MessageSquare className="h-5 w-5 text-blue-500" />
                   <div className="h-2 w-full bg-blue-200/50 rounded-full" />
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center gap-4">
                <div className="h-10 w-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-white">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Sincronización Activa</p>
                  <p className="text-xs text-emerald-600 font-medium">Airbnb, Booking & Directa conectados</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 text-center lg:text-left px-4">
            <h3 className="text-3xl font-black text-slate-800 tracking-tight leading-tight">
              La plataforma elegida por <span className="text-amber-500">Superhosts</span>
            </h3>
            <div className="flex items-center gap-4 flex-wrap justify-center lg:justify-start">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(i => <Star key={i} className="h-4 w-4 fill-amber-500 text-amber-500" />)}
              </div>
              <p className="text-sm font-bold text-slate-400">4.9/5 basado en +2,500 reseñas</p>
            </div>
          </div>
        </div>

      </div>

      <style jsx global>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(-5%); animation-timing-function: cubic-bezier(0.8,0,1,1); }
          50% { transform: none; animation-timing-function: cubic-bezier(0,0,0.2,1); }
        }
      `}</style>

    </main>
  );
}
