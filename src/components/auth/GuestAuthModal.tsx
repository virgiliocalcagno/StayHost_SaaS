"use client";

/**
 * Modal de login del huésped — un toque, simple, sin bla blas.
 *
 * Diseño:
 *   ┌──────────────────────────┐
 *   │  Iniciá sesión             │
 *   │                            │
 *   │  [🔵 Continuar con Google] │ ← OAuth, 1 toque
 *   │                            │
 *   │  ───── o con email ─────   │
 *   │                            │
 *   │  tu@email.com [Enviar]     │ ← magic link
 *   └──────────────────────────┘
 *
 * Google requiere setup en Supabase Dashboard → Auth → Providers → Google.
 * Si está deshabilitado, el botón sigue visible pero al tap muestra error.
 * Magic-link funciona out-of-the-box con el Gmail SMTP del proyecto.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL absoluta a la que volver tras el login (default: /cuenta). */
  redirectTo?: string;
}

export default function GuestAuthModal({ open, onOpenChange, redirectTo }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    setSending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const callback = redirectTo ?? `${window.location.origin}/cuenta`;
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback,
          // Pedir solo email + perfil básico, sin scopes extras.
          queryParams: { access_type: "online", prompt: "select_account" },
        },
      });
      if (oauthErr) {
        setError(
          oauthErr.message.includes("Provider")
            ? "Google no está configurado todavía. Usá email mientras tanto."
            : oauthErr.message,
        );
        setSending(false);
      }
      // Si no hay error, el browser redirige a Google. No bajamos setSending.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setSending(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Ingresá un email válido");
      return;
    }
    setSending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const callback = redirectTo ?? `${window.location.origin}/cuenta`;
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callback,
          // shouldCreateUser true es el default — usuarios nuevos pueden
          // loguearse a la primera y se les crea cuenta automaticamente.
        },
      });
      if (otpErr) {
        setError(otpErr.message);
      } else {
        setSent(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Iniciá sesión</DialogTitle>
          <DialogDescription>
            Para ver tu historial, gestionar pedidos y comprar más rápido.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
            <p className="font-bold">Revisá tu email</p>
            <p className="text-sm text-slate-600">
              Te mandamos un link a <strong>{email}</strong>. Tocalo desde tu celular para entrar — el link expira en 1 hora.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full font-semibold"
              onClick={handleGoogle}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <GoogleIcon className="h-5 w-5 mr-2" />
              )}
              Continuar con Google
            </Button>

            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[10px] text-slate-400 uppercase">o con email</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <form onSubmit={handleMagicLink} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  disabled={sending}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full gradient-gold text-white font-semibold"
                disabled={sending || !email}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Enviarme un link mágico
              </Button>
            </form>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-[10px] text-slate-400 text-center">
              Sin contraseñas. Sin spam. Solo tu cuenta de pedidos.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Logo de Google en SVG inline — evita dependencia + queda crujiente en alta DPI.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
