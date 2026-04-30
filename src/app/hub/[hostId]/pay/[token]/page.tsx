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

import { use, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Calendar, Users, Home } from "lucide-react";

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
  property: { name: string; address: string | null; city: string | null } | null;
  host: { id: string; name: string } | null;
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
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const sdkLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/payments/info?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: PayInfo) => {
        if (cancelled) return;
        setInfo(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(typeof err === "string" ? err : "No se pudo cargar la reserva");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      "disable-funding": "credit,card",
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.onload = renderButtons;
    script.onerror = () => setPayError("No se pudo cargar PayPal. Recargá la página.");
    document.body.appendChild(script);
  }, [info, paidNow, token]);

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

  return (
    <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6 py-12">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <Link href={`/hub/${hostId}`} className="text-sm text-slate-500 hover:text-amber-600 inline-flex items-center gap-1">
            <Home className="h-3.5 w-3.5" /> {info.host?.name}
          </Link>
          <h1 className="text-3xl font-extrabold text-slate-900 mt-3">
            {isPaid ? "Pago confirmado" : "Pagar reserva"}
          </h1>
          {info.booking.channelCode && (
            <p className="text-xs font-mono text-slate-500 mt-2 bg-slate-100 inline-block px-3 py-1 rounded-full">
              {info.booking.channelCode}
            </p>
          )}
        </div>

        {/* Resumen de la reserva */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
          {info.property && (
            <div>
              <p className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-1">Propiedad</p>
              <p className="font-bold text-slate-900">{info.property.name}</p>
              {info.property.city && (
                <p className="text-sm text-slate-500">{info.property.city}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
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
          {info.booking.numGuests && (
            <div className="pt-2 border-t">
              <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                <Users className="h-3 w-3" /> Huéspedes
              </p>
              <p className="font-bold text-sm">{info.booking.numGuests}</p>
            </div>
          )}
          <div className="border-t pt-3 flex justify-between items-baseline">
            <span className="text-sm font-bold uppercase text-slate-500 tracking-wider">Total</span>
            <span className="text-2xl font-extrabold text-amber-600">
              ${info.booking.total.toLocaleString()} {info.booking.currency}
            </span>
          </div>
        </div>

        {/* Estado pagado */}
        {isPaid && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold text-emerald-900">Pago recibido</p>
              <p className="text-xs text-emerald-700 mt-1">
                El host fue notificado. Te llegará confirmación por WhatsApp con instrucciones de check-in.
              </p>
              {info.booking.paidAt && (
                <p className="text-[10px] text-emerald-600 mt-1">
                  {new Date(info.booking.paidAt).toLocaleString("es-MX")}
                </p>
              )}
            </div>
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
