"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Eye,
  EyeOff,
  Lock,
  Building2,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * Página: recuperar contraseña (paso 2).
 *
 * Cuando el usuario hace click en el enlace del correo, Supabase lo redirige
 * aquí con un token en la URL y crea una sesión temporal con evento
 * `PASSWORD_RECOVERY`. Desde esa sesión sí podemos llamar `updateUser` para
 * fijar la nueva contraseña.
 *
 * Si alguien entra directo sin sesión válida, mostramos error y lo mandamos
 * de vuelta a /recuperar.
 */
export default function ActualizarPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase dispara PASSWORD_RECOVERY en cuanto detecta el token en la URL.
  // Escuchamos ese evento para habilitar el formulario. Si pasados unos
  // segundos no llega, asumimos que el enlace es inválido o expiró.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // Fallback: si ya hay sesión al cargar (p.ej. el link ya se procesó),
    // también permitimos continuar.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
    })();

    const timer = setTimeout(() => {
      // Si tras 3s seguimos sin sesión, mostramos error en vez de quedarnos
      // colgados en el spinner.
      setReady((r) => {
        if (!r) {
          setError(
            "Enlace inválido o expirado. Solicita uno nuevo desde 'Recuperar contraseña'."
          );
        }
        return r;
      });
    }, 3000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async () => {
    setError("");

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });

      if (authError) {
        setError(authError.message);
        return;
      }

      setDone(true);
      // Pequeño delay para que el usuario vea el mensaje de éxito.
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      console.error("[recuperar/actualizar] unexpected error:", err);
      setError("No se pudo actualizar la contraseña. Intenta de nuevo.");
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
            Nueva contraseña
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Define una nueva contraseña para tu cuenta
          </p>
        </div>

        <div className="bg-white/70 backdrop-blur-xl border border-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 p-8 space-y-8">
          {done ? (
            <div className="flex items-start gap-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 p-4 rounded-2xl animate-in slide-in-from-top-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Contraseña actualizada</p>
                <p className="font-medium text-emerald-600">
                  Te estamos llevando a tu panel...
                </p>
              </div>
            </div>
          ) : !ready && !error ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-5">
                <div className="space-y-3">
                  <Label
                    htmlFor="password"
                    className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1"
                  >
                    Nueva contraseña
                  </Label>
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
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="new-password"
                      disabled={!ready || loading}
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

                <div className="space-y-3">
                  <Label
                    htmlFor="confirm"
                    className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1"
                  >
                    Confirmar contraseña
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-slate-100 rounded-xl flex items-center justify-center group-focus-within:bg-primary/10 transition-colors">
                      <Lock className="h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                    </div>
                    <Input
                      id="confirm"
                      type={showPwd ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-16 h-14 rounded-2xl border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all font-medium text-lg tracking-widest placeholder:tracking-normal"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="new-password"
                      disabled={!ready || loading}
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
                disabled={!ready || loading || !password || !confirm}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Guardando...
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-base">
                    Guardar contraseña
                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </Button>

              {!ready && (
                <Link
                  href="/recuperar"
                  className="block text-center text-xs font-semibold text-slate-500 hover:text-primary transition-colors"
                >
                  Solicitar un nuevo enlace
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
