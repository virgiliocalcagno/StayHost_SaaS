"use client";

/**
 * /checkin — Página genérica de login del huésped.
 *
 * El huésped se loguea con un único dato: el código de reserva (ej. Airbnb:
 * HMXXXXXXXX) que recibió en su email. El código Airbnb tiene ~36^8 combina-
 * ciones; combinado con rate-limit por IP es suficientemente seguro contra
 * fuerza bruta y evita fricción (pedir también últimos 4 del teléfono era
 * redundante).
 *
 * Los últimos 4 del teléfono se siguen capturando del iCal pero se usan
 * internamente como valor por defecto del PIN de la cerradura TTLock.
 *
 * Al validar, el backend devuelve los datos de la reserva y redirigimos
 * al flow existente /checkin/[bookingId]?d=... (que ya maneja los 6 pasos).
 */

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, KeyRound, Loader2, AlertCircle } from "lucide-react";

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
    phoneLast4: string | null;
    channel: string;
    electricityEnabled: boolean;
    electricityRate: number;
    electricityTotal: number;
    wifiSsid: string | null;
    wifiPassword: string | null;
  };
}

function buildEncodedData(b: NonNullable<LookupResponse["booking"]>): string {
  // `l` (lastName) es el soft-token del backend para auth del huésped. Como
  // Airbnb no trae apellido, usamos el channel_code como pseudo-apellido
  // interno. `d4` (últimos 4 del tel) viene del booking, no del huésped —
  // se usa como valor por defecto del PIN TTLock que se le muestra al final.
  const payload = {
    n: b.guestName ?? "Huésped",
    l: b.channelCode,             // pseudo-apellido = código de reserva
    d4: b.phoneLast4 ?? "",       // sacado del booking, no del input
    ci: b.checkIn,
    co: b.checkOut,
    nt: b.nights,
    p: b.propertyName ?? "Propiedad",
    pa: b.propertyAddress ?? "",
    ch: b.channel,
    ee: b.electricityEnabled,
    er: b.electricityRate,
    et: b.electricityTotal,
    ws: b.wifiSsid ?? "",
    wp: b.wifiPassword ?? "",
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
  const [code, setCode] = useState(() => (searchParams.get("code") ?? searchParams.get("res") ?? "").toUpperCase());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError("");
    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, "");

    if (cleanCode.length < 6) {
      setError("El código de reserva es muy corto.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/checkin/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode }),
      });
      const data = (await res.json()) as LookupResponse;

      if (!data.ok || !data.booking) {
        setError(data.error ?? "No pudimos encontrar tu reserva.");
        return;
      }

      const encoded = buildEncodedData(data.booking);
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
            Ingresá tu código de reserva para continuar con el check-in.
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
            disabled={loading || code.trim().length < 6}
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
