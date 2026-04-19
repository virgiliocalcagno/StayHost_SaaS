"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Mail,
  Building2,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * Página: recuperar contraseña (paso 1).
 *
 * Pide el correo y dispara `supabase.auth.resetPasswordForEmail`. Supabase
 * envía un email con un link que apunta a /recuperar/actualizar, donde el
 * usuario define su nueva contraseña.
 *
 * Nota: por seguridad mostramos el mismo mensaje de éxito exista o no la
 * cuenta, para no filtrar qué correos están registrados.
 */
function RecuperarForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/recuperar/actualizar`
          : undefined;

      const { error: authError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo }
      );

      if (authError) {
        console.error("[recuperar] error:", authError);
        // No leakeamos si el email existe o no — mostramos éxito igual.
      }

      setSent(true);
    } catch (err) {
      console.error("[recuperar] unexpected error:", err);
      setError("No se pudo enviar el correo. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-white shadow-xl shadow-primary/10 border border-slate-100 mb-6 relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <Building2 className="h-10 w-10 text-primary relative z-10" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Recuperar contraseña
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Te enviaremos un enlace para restablecerla
          </p>
        </div>

        <div className="bg-white/70 backdrop-blur-xl border border-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 p-8 space-y-8">
          {sent ? (
            <div className="space-y-6">
              <div className="flex items-start gap-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 p-4 rounded-2xl animate-in slide-in-from-top-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Revisa tu correo</p>
                  <p className="font-medium text-emerald-600">
                    Si <span className="font-bold">{email}</span> está
                    registrado, te enviamos un enlace para restablecer tu
                    contraseña.
                  </p>
                </div>
              </div>

              <Link href="/acceso">
                <Button
                  variant="outline"
                  className="w-full h-14 rounded-2xl font-bold group"
                >
                  <ArrowLeft className="h-5 w-5 mr-2 group-hover:-translate-x-1 transition-transform" />
                  Volver al inicio de sesión
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-5">
                <div className="space-y-3">
                  <Label
                    htmlFor="email"
                    className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1"
                  >
                    Correo Electrónico
                  </Label>
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
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="email"
                    />
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
                onClick={handleSubmit}
                disabled={loading || !email}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Enviando...
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-base">
                    Enviar enlace
                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </Button>

              <Link
                href="/acceso"
                className="block text-center text-xs font-semibold text-slate-500 hover:text-primary transition-colors"
              >
                ← Volver al inicio de sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RecuperarPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Cargando...</p>
        </div>
      }
    >
      <RecuperarForm />
    </Suspense>
  );
}
