"use client";

/**
 * /hub/[hostId]/pay/[token]
 *
 * Página pública donde el huésped paga su reserva confirmada. El
 * paymentToken (UUID) lo recibe por WhatsApp del host. Resuelve el
 * booking, monta el SDK de PayPal con el client_id PUBLICO del host
 * (sandbox o live según config) y al completar la captura marca el
 * booking como pagado.
 *
 * El SDK de PayPal se carga via <script> dinámico — no metemos
 * @paypal/react-paypal-js para no agregar dependencia. Smart Buttons
 * aceptan callbacks createOrder/onApprove que llaman a nuestros
 * endpoints public.
 */

import { use, useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Loader2, CheckCircle2, AlertCircle, Calendar, Users, Home,
  Copy, Phone, Mail, MapPin, MessageCircle, Printer, Check,
} from "lucide-react";

type PayInfo = {
  booking: {
    id: string;
    status: string;
    paid: boolean;
    paidAt: string | null;
    total: number;
    currency: string;
    checkIn: string;
    checkOut: string;
    guestName: string | null;
    numGuests: number | null;
    channelCode: string | null;
  };
  property: {
    name: string;
    address: string | null;
    city: string | null;
    neighborhood: string | null;
  } | null;
  host: {
    id: string;
    name: string;
    email: string | null;
    whatsapp: string | null;
    welcomeMessage: string | null;
  } | null;
  paypal: { clientId: string; mode: "sandbox" | "live" } | null;
};

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: unknown) => { render: (selector: string) => void };
    };
  }
}

export default function PayPage({ params }: { params: Promise<{ hostId: string; token: string }> }) {
  const { hostId, token } = use(params);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidNow, setPaidNow] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const sdkLoaded = useRef(false);

  // Función centralizada porque la llamamos al montar Y después del pago
  // (para traer el channel_code recién generado por el capture endpoint).
  const fetchInfo = useCallback(async () => {
    const r = await fetch(`/api/public/payments/info?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.statusText);
    return (await r.json()) as PayInfo;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    fetchInfo()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar la reserva");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchInfo]);

  // Cargar SDK de PayPal cuando tengamos info.paypal y el booking no esté pagado.
  useEffect(() => {
    if (!info?.paypal || !buttonsRef.current) return;
    if (info.booking.paid || paidNow) return;
    if (sdkLoaded.current) return;
    sdkLoaded.current = true;

    const scriptId = "paypal-sdk";
    const existing = document.getElementById(scriptId);
    const renderButtons = () => {
      if (!window.paypal || !buttonsRef.current) return;
      buttonsRef.current.innerHTML = "";
      window.paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "pay" },
        createOrder: async () => {
          setPayError(null);
          setPaying(true);
          try {
            const res = await fetch("/api/public/payments/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentToken: token }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `HTTP ${res.status}`);
            }
            const j = (await res.json()) as { orderId: string };
            return j.orderId;
          } catch (err) {
            setPayError(err instanceof Error ? err.message : String(err));
            setPaying(false);
            throw err;
          }
        },
        onApprove: async (data: { orderID: string }) => {
          try {
            const res = await fetch("/api/public/payments/paypal/capture", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentToken: token, orderId: data.orderID }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `HTTP ${res.status}`);
            }
            setPaidNow(true);
            // Re-fetch info: el capture genera channel_code (auto-confirma
            // pending_review→confirmed) y queremos mostrarlo en pantalla.
            try {
              const fresh = await fetchInfo();
              setInfo(fresh);
            } catch {
              /* el setPaidNow ya muestra confirmación; channel_code aparecera tras refresh manual */
            }
          } catch (err) {
            setPayError(err instanceof Error ? err.message : String(err));
          } finally {
            setPaying(false);
          }
        },
        onCancel: () => {
          setPaying(false);
        },
        onError: (err: unknown) => {
          setPayError(err instanceof Error ? err.message : "Error en PayPal");
          setPaying(false);
        },
      }).render("#paypal-buttons");
    };

    if (existing) {
      renderButtons();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    const params = new URLSearchParams({
      "client-id": info.paypal.clientId,
      currency: info.booking.currency,
      intent: "capture",
      // disable PayPal Credit (USA-only, irrelevante en LATAM) y paylater
      // (financiación post-compra). NO deshabilitar 'card' — ése es el
      // botón "Debit or Credit Card" / Guest Checkout que queremos mostrar.
      "disable-funding": "credit,paylater",
      "enable-funding": "card",
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.onload = renderButtons;
    script.onerror = () => setPayError("No se pudo cargar PayPal. Recargá la página.");
    document.body.appendChild(script);
  }, [info, paidNow, token, fetchInfo]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
      </main>
    );
  }

  if (error || !info) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-400" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Enlace inválido</h1>
          <p className="text-slate-600">
            El enlace de pago que abriste no es válido o expiró. Pedile al host que te envíe uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  const isPaid = info.booking.paid || paidNow;
  const fullAddress = [info.property?.address, info.property?.neighborhood, info.property?.city]
    .filter(Boolean)
    .join(", ");

  // Texto de WhatsApp pre-cargado para que el huésped contacte al host
  // sin tener que tipear nada — copia el modelo de Airbnb.
  const waMessage = info.host?.whatsapp
    ? `Hola ${info.host.name}, soy ${info.booking.guestName ?? "tu huésped"}. ` +
      `Acabo de pagar mi reserva en ${info.property?.name ?? "la propiedad"}` +
      `${info.booking.channelCode ? ` (código ${info.booking.channelCode})` : ""}. ` +
      `Check-in ${info.booking.checkIn}, check-out ${info.booking.checkOut}. ` +
      `Quedo atento/a a las instrucciones de llegada. ¡Gracias!`
    : "";
  const waLink = info.host?.whatsapp
    ? `https://wa.me/${info.host.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(waMessage)}`
    : null;

  const copyCode = () => {
    if (!info.booking.channelCode) return;
    navigator.clipboard.writeText(info.booking.channelCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-[#FDFBF7] px-6 py-12 print:bg-white print:py-0">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <Link href={`/hub/${hostId}`} className="text-sm text-slate-500 hover:text-amber-600 inline-flex items-center gap-1 print:hidden">
            <Home className="h-3.5 w-3.5" /> {info.host?.name}
          </Link>
          <h1 className="text-3xl font-extrabold text-slate-900 mt-3">
            {isPaid ? "¡Reserva confirmada!" : "Pagar reserva"}
          </h1>
          {isPaid && (
            <p className="text-sm text-slate-600 mt-2">
              Tu pago fue procesado correctamente. Guarda esta página o imprimila como comprobante.
            </p>
          )}
        </div>

        {/* CÓDIGO DE RESERVA — protagonista de la pantalla cuando ya está pagado */}
        {isPaid && info.booking.channelCode && (
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-2 border-emerald-300 rounded-3xl p-6 text-center">
            <p className="text-xs font-bold uppercase text-emerald-700 tracking-wider mb-2">
              Tu código de reserva
            </p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-3xl font-mono font-extrabold text-emerald-900 tracking-wider">
                {info.booking.channelCode}
              </p>
              <button
                onClick={copyCode}
                className="p-2 rounded-lg hover:bg-emerald-200 transition-colors print:hidden"
                title="Copiar código"
              >
                {codeCopied ? (
                  <Check className="h-5 w-5 text-emerald-700" />
                ) : (
                  <Copy className="h-5 w-5 text-emerald-700" />
                )}
              </button>
            </div>
            <p className="text-xs text-emerald-700 mt-3">
              Vas a necesitarlo para hacer tu check-in. Guardalo o tomale captura.
            </p>
          </div>
        )}

        {/* Resumen de la reserva */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
          {info.property && (
            <div>
              <p className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-1">Propiedad</p>
              <p className="font-bold text-slate-900 text-lg">{info.property.name}</p>
              {fullAddress && (
                <p className="text-sm text-slate-600 flex items-start gap-1.5 mt-1">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>{fullAddress}</span>
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-3 border-t">
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Check-in
              </p>
              <p className="font-bold text-sm">{info.booking.checkIn}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Check-out
              </p>
              <p className="font-bold text-sm">{info.booking.checkOut}</p>
            </div>
          </div>
          {(info.booking.numGuests || info.booking.guestName) && (
            <div className="pt-2 border-t grid grid-cols-2 gap-3">
              {info.booking.guestName && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Huésped principal</p>
                  <p className="font-bold text-sm">{info.booking.guestName}</p>
                </div>
              )}
              {info.booking.numGuests && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                    <Users className="h-3 w-3" /> Huéspedes
                  </p>
                  <p className="font-bold text-sm">{info.booking.numGuests}</p>
                </div>
              )}
            </div>
          )}
          <div className="border-t pt-3 flex justify-between items-baseline">
            <span className="text-sm font-bold uppercase text-slate-500 tracking-wider">
              {isPaid ? "Pagado" : "Total"}
            </span>
            <span className={`text-2xl font-extrabold ${isPaid ? "text-emerald-600" : "text-amber-600"}`}>
              ${info.booking.total.toLocaleString()} {info.booking.currency}
            </span>
          </div>
          {isPaid && info.booking.paidAt && (
            <p className="text-[10px] text-slate-400 text-right">
              Procesado el {new Date(info.booking.paidAt).toLocaleString("es-MX")}
            </p>
          )}
        </div>

        {/* CONTACTO DEL HOST — solo si está pagado, para que el huésped lo
            tenga a mano sin que se pierda en su email. Lo más importante:
            el botón de WhatsApp con mensaje pre-cargado. */}
        {isPaid && info.host && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-1">
                Tu host
              </p>
              <p className="font-bold text-slate-900 text-lg">{info.host.name}</p>
              {info.host.welcomeMessage && (
                <p className="text-sm text-slate-600 mt-2 italic bg-amber-50 p-3 rounded-xl border border-amber-100">
                  &ldquo;{info.host.welcomeMessage}&rdquo;
                </p>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white transition-colors print:hidden"
                >
                  <MessageCircle className="h-5 w-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold opacity-90">Mensaje al host</p>
                    <p className="font-bold truncate">WhatsApp</p>
                  </div>
                </a>
              )}
              {info.host.email && (
                <a
                  href={`mailto:${info.host.email}?subject=${encodeURIComponent(`Reserva ${info.booking.channelCode ?? ""}`)}`}
                  className="flex items-center gap-3 p-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-900 transition-colors print:hidden"
                >
                  <Mail className="h-5 w-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold opacity-70">Email del host</p>
                    <p className="font-bold truncate text-sm">{info.host.email}</p>
                  </div>
                </a>
              )}
            </div>
            {/* Versión imprimible del contacto — el botón mailto/wa no
                aparece en print, así que mostramos los datos crudos */}
            <div className="hidden print:block text-sm space-y-1 pt-2 border-t">
              {info.host.whatsapp && (
                <p><strong>WhatsApp:</strong> {info.host.whatsapp}</p>
              )}
              {info.host.email && (
                <p><strong>Email:</strong> {info.host.email}</p>
              )}
            </div>
          </div>
        )}

        {/* PRÓXIMOS PASOS — qué tiene que hacer el huésped a partir de ahora */}
        {isPaid && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
            <p className="text-xs font-bold uppercase text-slate-500 tracking-wider">
              Próximos pasos
            </p>
            <ol className="space-y-3 text-sm text-slate-700">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center">1</span>
                <span>Te enviamos un email con todos los datos de tu reserva. Revisá tu bandeja (y el spam por si acaso).</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center">2</span>
                <span>Tu host te va a contactar por WhatsApp 24-48hs antes de tu llegada con instrucciones de check-in (dirección exacta, código de acceso o llaves).</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center">3</span>
                <span>Si necesitás cambiar algo o tenés dudas, escribile al host directo por WhatsApp con tu código <strong>{info.booking.channelCode ?? "de reserva"}</strong>.</span>
              </li>
            </ol>
          </div>
        )}

        {/* ACCIONES — imprimir comprobante + volver al hub */}
        {isPaid && (
          <div className="flex flex-col sm:flex-row gap-3 print:hidden">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" /> Imprimir comprobante
            </Button>
            <Button asChild className="flex-1 gap-2 bg-amber-500 hover:bg-amber-600 text-white">
              <Link href={`/hub/${hostId}`}>
                <Home className="h-4 w-4" /> Volver al sitio del host
              </Link>
            </Button>
          </div>
        )}

        {/* PayPal Smart Buttons (solo si no pagado y host tiene config) */}
        {!isPaid && info.paypal && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Pagar con PayPal</p>
            <div ref={buttonsRef} id="paypal-buttons" />
            {paying && (
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Procesando...
              </p>
            )}
            {payError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{payError}</span>
              </div>
            )}
            {info.paypal.mode === "sandbox" && (
              <p className="text-[10px] text-amber-600 italic">
                Modo sandbox (pruebas) — no se realizará un cargo real.
              </p>
            )}
          </div>
        )}

        {/* Sin PayPal configurado */}
        {!isPaid && !info.paypal && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold text-amber-900">Pago en línea no disponible</p>
              <p className="text-xs text-amber-700 mt-1">
                El host coordinará el cobro contigo por WhatsApp.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
