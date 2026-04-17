"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  Building2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

// ─── Session Type ─────────────────────────────────────────────────────────────
export interface StaffSession {
  memberId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  permissions: {
    canViewAnalytics: boolean;
    canManageTasks: boolean;
    canMessageGuests: boolean;
    canEditProperties: boolean;
  };
  propertyAccess: "all" | string[];
  available: boolean;
}

// ─── Login Form ───────────────────────────────────────────────────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const session = localStorage.getItem("stayhost_session");
      if (session) router.replace("/staff");
    } catch {}
  }, [router]);

  const handleLogin = () => {
    setError("");
    setLoading(true);

    try {
      const teamRaw = localStorage.getItem("stayhost_team");
      const isGodMode = email.toLowerCase().trim() === "virgiliocalcagno@gmail.com";

      if (!teamRaw && !isGodMode) {
        setError("No hay equipo registrado. Contacta al administrador.");
        setLoading(false);
        return;
      }

      const team = teamRaw ? JSON.parse(teamRaw) : [];
      let member = team.find(
        (m: { email: string }) =>
          m.email.toLowerCase() === email.toLowerCase().trim()
      );

      // BYPASS MODO OWNER: Si eres tú, te creamos una cuenta virtual si no existes

      if (!member && isGodMode) {
        member = {
          id: "god-001",
          name: "Virgilio (Master)",
          email: "virgiliocalcagno@gmail.com",
          role: "OWNER",
          status: "active",
          permissions: {
            canViewAnalytics: true,
            canManageTasks: true,
            canMessageGuests: true,
            canEditProperties: true,
          }
        };
      } else if (!member) {
        setError("Correo no encontrado. Verifica con tu administrador.");
        setLoading(false);
        return;
      }

      // Validamos contraseña solo si NO es el Modo OWNER
      if (!isGodMode && member.password && member.password !== password) {
        setError("Contraseña incorrecta.");
        setLoading(false);
        return;
      }

      if (member.status === "inactive") {
        setError("Tu cuenta está inactiva. Contacta al administrador.");
        setLoading(false);
        return;
      }

      // Build and persist session
      const session: StaffSession = {
        memberId: member.id,
        name: member.name,
        role: isGodMode ? "OWNER" : member.role,
        email: member.email,
        phone: member.phone || "",
        permissions: isGodMode ? {
          canViewAnalytics: true,
          canManageTasks: true,
          canMessageGuests: true,
          canEditProperties: true,
        } : (member.permissions || {
          canViewAnalytics: false,
          canManageTasks: true,
          canMessageGuests: false,
          canEditProperties: false,
        }),
        propertyAccess: isGodMode ? "all" : (member.propertyAccess || "all"),
        available: member.available ?? true,
      };
      localStorage.setItem("stayhost_session", JSON.stringify(session));

      // Mark member as active
      const updatedTeam = team.map((m: { id: string; role?: string }) =>
        m.id === member.id
          ? { ...m, status: "active", lastActive: "En línea", role: isGodMode ? "OWNER" : m.role }
          : m
      );
      localStorage.setItem("stayhost_team", JSON.stringify(updatedTeam));

      // Redirección inteligente basada en el rol
      if (email.toLowerCase() === "virgiliocalcagno@gmail.com") {
        router.push("/dashboard");
      } else {
        router.push("/staff");
      }
    } catch {
      setError("Error al iniciar sesión. Intenta de nuevo.");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4 relative overflow-hidden">
      {/* Background Decorators */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Logo Section */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-white shadow-xl shadow-primary/10 border border-slate-100 mb-6 relative group overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <Building2 className="h-10 w-10 text-primary relative z-10" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Portal de Staff</h1>
          <p className="text-slate-500 text-sm font-medium">
            Acceso seguro para el equipo StayHost
          </p>
        </div>

        {/* Glassmorphism Card */}
        <div className="bg-white/70 backdrop-blur-xl border border-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 p-8 space-y-8">
          <div className="space-y-5">
            <div className="space-y-3">
              <Label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1">Correo Electrónico</Label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-slate-100 rounded-xl flex items-center justify-center group-focus-within:bg-primary/10 transition-colors">
                   <Mail className="h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@correo.com"
                  className="pl-16 h-14 rounded-2xl border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="password" className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1">Contraseña secreta</Label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-slate-100 rounded-xl flex items-center justify-center group-focus-within:bg-primary/10 transition-colors">
                   <Lock className="h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                </div>
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  className="pl-16 pr-14 h-14 rounded-2xl border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all font-medium text-lg tracking-widest placeholder:tracking-normal"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((p) => !p)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors p-2 bg-slate-50 hover:bg-primary/10 rounded-xl"
                >
                  {showPwd ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 text-sm text-rose-600 bg-rose-50 border border-rose-100 p-4 rounded-2xl animate-in slide-in-from-top-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
            )}
          </div>

          <Button
            className="w-full h-14 rounded-2xl gradient-gold text-primary-foreground font-bold shadow-xl shadow-primary/20 transition-all group"
            onClick={handleLogin}
            disabled={loading || !email}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                 <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                 Autenticando...
              </div>
            ) : (
              <div className="flex items-center gap-2 text-base">
                Ingresar al sistema
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </div>
            )}
          </Button>

          <p className="text-center text-xs font-semibold text-slate-400">
            ¿Problemas para acceder? Contacta a tu jefe directo.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AccesoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Cargando...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
