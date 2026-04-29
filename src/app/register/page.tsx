"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowRight,
  MessageSquare,
  Calendar,
  ShieldCheck,
  Star,
  Mail,
  CheckCircle2,
  AlertCircle,
  LogOut,
  LayoutDashboard,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * Pagina de registro / "Prueba Gratis 14 dias".
 *
 * Flujo:
 *   1. Usuario llena email + password + nombre + acepta terminos.
 *   2. Llamamos supabase.auth.signUp.
 *   3. Si Supabase tiene "Confirm email" ON, devuelve session=null y user=
 *      con email_confirmed_at=null → mostramos pantalla "Revisa tu correo".
 *   4. Si "Confirm email" esta OFF, devuelve session activa → redirect a
 *      /dashboard.
 *
 * No hacemos OAuth (Google/Airbnb) por ahora — los botones quedan ocultos.
 */
export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [updates, setUpdates] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  // null = todavia no chequeamos. Si hay user no mostramos el form,
  // mostramos pantalla "ya tenes sesion" para evitar que un master
  // logueado "se registre" y termine confundido viendo sus mismos datos
  // bajo otro full_name.
  const [activeUserEmail, setActiveUserEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setActiveUserEmail(data.user?.email ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    fullName.trim().length > 0 &&
    acceptedTerms &&
    !loading;

  const handleRegister = async () => {
    setError("");
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            marketing_opt_in: updates,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.toLowerCase().includes("already registered")) {
          setError("Este correo ya está registrado. Iniciá sesión.");
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // Confirm email ON → session viene null, hay que verificar el correo.
      if (!data.session) {
        setEmailSent(true);
        return;
      }

      // Confirm email OFF → entrar directo.
      window.location.assign("/dashboard");
    } catch (err) {
      console.error("[register] unexpected error:", err);
      setError("No pudimos crear la cuenta. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  // Mientras no sabemos si hay sesion, no renderizamos nada — evita el flash
  // del form a un usuario que ya esta logueado.
  if (activeUserEmail === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div className="h-8 w-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </main>
    );
  }

  if (activeUserEmail) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white p-8">
        <div className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-amber-50 border border-amber-100">
            <CheckCircle2 className="h-10 w-10 text-amber-500" />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Ya tenés una cuenta activa
            </h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              Estás logueado como{" "}
              <span className="font-bold text-slate-700">{activeUserEmail}</span>
              . Para crear una cuenta nueva primero tenés que cerrar la actual.
            </p>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <Button asChild className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-bold">
              <Link href="/dashboard" className="flex items-center justify-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Ir al Dashboard
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full h-12 font-bold">
              <a href="/salir" className="flex items-center justify-center gap-2">
                <LogOut className="h-4 w-4" />
                Cerrar sesión y registrar otra
              </a>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (emailSent) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white p-8">
        <div className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-emerald-50 border border-emerald-100">
            <Mail className="h-10 w-10 text-emerald-500" />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Revisá tu correo
            </h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              Te enviamos un enlace de confirmación a{" "}
              <span className="font-bold text-slate-700">{email}</span>. Hacé
              click ahí para activar tu cuenta y empezar la prueba.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Si no lo ves, revisá la carpeta de spam.
          </div>
          <Link
            href="/acceso"
            className="inline-block text-sm font-bold text-amber-600 hover:underline"
          >
            Ya confirmé, ir a iniciar sesión →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-white">
      {/* ── LEFT SIDE: Form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col p-8 md:p-16 lg:p-24 max-w-2xl mx-auto md:mx-0">
        <div className="mb-12">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:rotate-6 transition-transform">
              <span className="text-white font-black text-xl italic">S</span>
            </div>
            <span className="text-2xl font-black text-slate-900 tracking-tighter">
              StayHost
            </span>
          </Link>
        </div>

        <div className="space-y-8 flex-1 flex flex-col justify-center">
          <div className="space-y-3">
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Comienza tu prueba{" "}
              <span className="text-amber-500">gratuita</span> abajo
            </h1>
            <p className="text-slate-500 font-medium italic">
              Ya tienes una cuenta?{" "}
              <Link
                href="/acceso"
                className="text-amber-600 font-bold hover:underline"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="fullName"
                className="text-xs font-black uppercase tracking-widest text-slate-400"
              >
                Nombre completo
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Tu nombre"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && handleRegister()}
                className="h-14 rounded-xl border-slate-200 focus:ring-amber-500/20 text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-xs font-black uppercase tracking-widest text-slate-400"
              >
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && handleRegister()}
                className="h-14 rounded-xl border-slate-200 focus:ring-amber-500/20 text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-xs font-black uppercase tracking-widest text-slate-400"
              >
                Contraseña <span className="text-slate-300 normal-case">(mín. 6 caracteres)</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && handleRegister()}
                className="h-14 rounded-xl border-slate-200 focus:ring-amber-500/20 text-lg"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="updates"
                  checked={updates}
                  onCheckedChange={(v) => setUpdates(v === true)}
                  className="mt-1 border-slate-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                />
                <Label
                  htmlFor="updates"
                  className="text-xs text-slate-500 leading-relaxed font-medium cursor-pointer"
                >
                  Recibe consejos, actualizaciones y ofertas de StayHost.
                  Cancelá cuando quieras.{" "}
                  <span className="text-slate-300 italic">(opcional)</span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(v) => setAcceptedTerms(v === true)}
                  className="mt-1 border-slate-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                />
                <Label
                  htmlFor="terms"
                  className="text-xs text-slate-500 leading-relaxed font-medium cursor-pointer"
                >
                  Acepto los{" "}
                  <Link href="/terms" target="_blank" className="text-amber-500 underline">
                    Términos y Condiciones
                  </Link>{" "}
                  y la{" "}
                  <Link href="/privacy" target="_blank" className="text-amber-500 underline">
                    Política de Privacidad
                  </Link>{" "}
                  *
                </Label>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 text-sm text-rose-600 bg-rose-50 border border-rose-100 p-4 rounded-xl">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            <Button
              onClick={handleRegister}
              disabled={!canSubmit}
              className="w-full h-14 bg-amber-500 hover:bg-amber-600 text-white font-black text-lg rounded-xl shadow-xl shadow-amber-500/20 border-none group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Creando cuenta...
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-12 text-[10px] text-slate-300 font-bold uppercase tracking-widest flex justify-between items-center">
          <span>© 2024–2026 StayHost Inc.</span>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-slate-500">
              Seguridad
            </Link>
            <Link href="#" className="hover:text-slate-500">
              Soporte
            </Link>
          </div>
        </div>
      </div>

      {/* ── RIGHT SIDE: Preview / Social Proof ──────────────────────── */}
      <div className="hidden lg:flex flex-1 bg-slate-50 relative overflow-hidden items-center justify-center p-24">
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
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-8 h-8 rounded-full border-2 border-white bg-slate-200 shadow-sm"
                    />
                  ))}
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
                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">
                    Sincronización Activa
                  </p>
                  <p className="text-xs text-emerald-600 font-medium">
                    Airbnb, Booking & Directa conectados
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 text-center lg:text-left px-4">
            <h3 className="text-3xl font-black text-slate-800 tracking-tight leading-tight">
              La plataforma elegida por{" "}
              <span className="text-amber-500">Superhosts</span>
            </h3>
            <div className="flex items-center gap-4 flex-wrap justify-center lg:justify-start">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    className="h-4 w-4 fill-amber-500 text-amber-500"
                  />
                ))}
              </div>
              <p className="text-sm font-bold text-slate-400">
                4.9/5 basado en +2,500 reseñas
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
