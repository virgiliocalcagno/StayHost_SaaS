"use client";

/**
 * /checkin — Página genérica de login del huésped.
 *
 * Reemplaza el paradigma anterior de "un link único por reserva" con una URL
 * pública que el huésped puede llegar por WhatsApp o tipeándola. Se loguea
 * con:
 *   1. Código de reserva (ej. Airbnb: HMXXXXXXXX) que recibió en su email.
 *   2. Últimos 4 dígitos de su teléfono (lo que Airbnb comparte con el host
 *      vía iCal, y que el guest registró al reservar).
 *
 * Al validar, el backend nos devuelve los datos de la reserva y redirigimos
 * al flow existente /checkin/[bookingId]?d=... (que ya maneja los 6 pasos).
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, KeyRound, Phone, Loader2, AlertCircle } from "lucide-react";

interface LookupResponse {
  ok: boolean;
  error?: string;
  booking?: {
    id: string;
    channelCode: string;
    propertyId: string;
    propertyName: string | null;
    propertyAddress: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestName: string | null;
    tenantId: string;
  };
}

function buildEncodedData(b: NonNullable<LookupResponse["booking"]>, last4: string): string {
  const payload = {
    n: b.guestName ?? "Huésped",
    l: "",                  // lastName — se captura en el flow
    d4: last4,
    ci: b.checkIn,
    co: b.checkOut,
    nt: b.nights,
    p: b.propertyName ?? "Propiedad",
    pa: b.propertyAddress ?? "",
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    return "";
  }
}

export default function CheckinLandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Cargando…</div>}>
      <CheckinForm />
    </Suspense>
  );
}

function CheckinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(() => (searchParams.get("code") ?? "").toUpperCase());
  const [last4, setLast4] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Si el huésped llega con ?code= en la URL (desde el WhatsApp del host),
  // hacemos focus automático en el campo de teléfono para que solo tenga que
  // tipear 4 números y listo.
  useEffect(() => {
    if (searchParams.get("code")) {
      document.getElementById("last4")?.focus();
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError("");
    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, "");
    const cleanLast4 = last4.trim();

    if (cleanCode.length < 6) {
      setError("El código de reserva es muy corto.");
      return;
    }
    if (!/^\d{4}$/.test(cleanLast4)) {
      setError("Los últimos 4 dígitos deben ser numéricos.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/checkin/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode, phoneLast4: cleanLast4 }),
      });
      const data = (await res.json()) as LookupResponse;

      if (!data.ok || !data.booking) {
        setError(data.error ?? "No pudimos encontrar tu reserva.");
        return;
      }

      const encoded = buildEncodedData(data.booking, cleanLast4);
      router.push(`/checkin/${data.booking.id}?d=${encoded}&v=2`);
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-xl shadow-primary/10 border border-slate-100 mb-4">
            <Building2 className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            Bienvenido
          </h1>
          <p className="text-slate-500 text-sm mt-2 px-4">
            Para hacer tu check-in, ingresá los datos de tu reserva.
          </p>
        </div>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/80 backdrop-blur-xl border border-slate-100 rounded-3xl shadow-2xl shadow-slate-200/50 p-6 space-y-5"
        >
          {/* Código de reserva */}
          <div className="space-y-2">
            <label
              htmlFor="code"
              className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1"
            >
              Código de Reserva
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center">
                <KeyRound className="h-4 w-4 text-slate-400" />
              </div>
              <input
                id="code"
                type="text"
                placeholder="HM..."
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect="off"
                className="w-full pl-16 pr-4 h-14 rounded-2xl border border-slate-200 bg-white/70 text-base font-mono font-bold tracking-wider focus:ring-2 focus:ring-primary/30 focus:border-primary/30 outline-none transition-all"
              />
            </div>
            <p className="text-[11px] text-slate-400 pl-1">
              Lo encontrás en el email de confirmación de Airbnb/VRBO/Booking.
            </p>
          </div>

          {/* Últimos 4 dígitos del teléfono */}
          <div className="space-y-2">
            <label
              htmlFor="last4"
              className="text-xs font-bold uppercase tracking-widest text-slate-400 pl-1"
            >
              Últimos 4 dígitos del teléfono
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center">
                <Phone className="h-4 w-4 text-slate-400" />
              </div>
              <input
                id="last4"
                type="tel"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="w-full pl-16 pr-4 h-14 rounded-2xl border border-slate-200 bg-white/70 text-base font-mono font-bold tracking-[0.5em] text-center focus:ring-2 focus:ring-primary/30 focus:border-primary/30 outline-none transition-all"
              />
            </div>
            <p className="text-[11px] text-slate-400 pl-1">
              El teléfono que usaste al reservar.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !code.trim() || last4.length !== 4}
            className="w-full h-14 rounded-2xl gradient-gold text-primary-foreground font-bold text-base shadow-xl shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Buscando…
              </>
            ) : (
              "Buscar mi reserva"
            )}
          </button>
        </form>

        {/* Pie */}
        <p className="text-center text-xs text-slate-400 mt-8 px-4">
          ¿Problemas para acceder? Contactá a tu anfitrión directamente.
        </p>
      </div>
    </main>
  );
}
