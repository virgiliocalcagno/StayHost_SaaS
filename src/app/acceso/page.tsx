"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
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
import { supabase } from "@/lib/supabase/client";

/**
 * Login page.
 *
 * Uses Supabase Auth (`signInWithPassword`). The session is stored in an
 * httpOnly cookie managed by @supabase/ssr — not in localStorage. After
 * login we redirect to the `next` query param if present, or to /dashboard
 * as a default.
 *
 * The old "god mode" bypass and localStorage-based team lookup are gone.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If the user is already logged in (e.g. refreshed the login page),
  // bounce them to their destination.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (data.user) {
        const next = searchParams.get("next") ?? "/dashboard";
        router.replace(next);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        // Supabase returns "Invalid login credentials" for both wrong email
        // and wrong password — intentional, to avoid leaking which one was
        // wrong to an attacker. We translate the message for the user.
        setError(
          authError.message === "Invalid login credentials"
            ? "Correo o contraseña incorrectos."
            : authError.message
        );
        return;
      }

      if (!data.user) {
        setError("No se pudo iniciar sesión. Intenta de nuevo.");
        return;
      }

      const next = searchParams.get("next") ?? "/dashboard";
      router.push(next);
    } catch (err) {
      console.error("[login] unexpected error:", err);
      setError("Error al iniciar sesión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
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
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="password" className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1">Contraseña</Label>
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
                  autoComplete="current-password"
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
            disabled={loading || !email || !password}
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

          <div className="flex flex-col items-center gap-2">
            <Link
              href={`/recuperar${email ? `?email=${encodeURIComponent(email)}` : ""}`}
              className="text-xs font-semibold text-primary hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
            <p className="text-center text-xs font-semibold text-slate-400">
              ¿Problemas para acceder? Contacta a tu administrador.
            </p>
          </div>
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
