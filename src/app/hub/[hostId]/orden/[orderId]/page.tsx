"use client";

/**
 * /hub/[hostId]/orden/[orderId]?t=<customerToken>
 *
 * Página pública donde el huésped completa el pago PayPal de una orden
 * de Ventas Extras. Carga el resumen de la orden, monta el SDK de PayPal
 * con el client_id del host, y al capturar exitoso muestra confirmación.
 *
 * Mismo patrón que /hub/[hostId]/pay/[token] pero para service_orders.
 */

import { use, useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShoppingCart,
  Calendar,
  MessageCircle,
  Mail,
  Home,
  QrCode,
  Hash,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { formatMoney } from "@/lib/money/format";

interface OrderInfo {
  order: {
    id: string;
    status: string;
    total: number;
    currency: string;
    paidAt: string | null;
    paymentId: string | null;
    guestName: string;
    // guestEmail/guestPhone NO se devuelven al cliente — el huésped los
    // tipeó en el carrito y los conoce. Quitarlos del response público
    // evita leak por intercepción del customer_token (queda en logs URL).
    notes: string | null;
    createdAt: string;
    // Sprint 6 — credenciales de redención que el huésped muestra al vendor.
    redemptionToken: string | null;
    redemptionPin: string | null;
    vendorStatus: string;
    redeemedAt: string | null;
    // Sprint 7.5 — para armar wa.me click-to-chat al vendor.
    vendorActionToken: string | null;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      pricingModel: string;
      unitPrice: number;
      lineTotal: number;
      serviceDate: string | null;
      vendor: { name: string; phone: string | null } | null;
    }>;
  };
  host: {
    name: string;
    contactEmail: string | null;
    whatsapp: string | null;
    logo: string | null;
  };
  paypal: { clientId: string; mode: "sandbox" | "live" } | null;
}

const VENDOR_STATUS_LABELS: Record<string, { es: string; en: string; cls: string }> = {
  awaiting: {
    es: "⏳ Aguardando confirmación del proveedor",
    en: "⏳ Waiting for vendor confirmation",
    cls: "bg-amber-50 border-amber-200 text-amber-900",
  },
  confirmed: {
    es: "✓ El proveedor confirmó tu reserva",
    en: "✓ Vendor confirmed your booking",
    cls: "bg-blue-50 border-blue-200 text-blue-900",
  },
  declined: {
    es: "✗ El proveedor no puede atender — el host te contactará",
    en: "✗ Vendor can't fulfill — your host will contact you",
    cls: "bg-rose-50 border-rose-200 text-rose-900",
  },
  delivered: {
    es: "✅ Servicio entregado",
    en: "✅ Service delivered",
    cls: "bg-emerald-50 border-emerald-200 text-emerald-900",
  },
  no_show: {
    es: "❌ No te presentaste al servicio",
    en: "❌ No-show",
    cls: "bg-slate-50 border-slate-200 text-slate-700",
  },
};

const PRICING_SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: unknown) => { render: (selector: string) => void };
    };
  }
}

export default function ServiceOrderPayPage({
  params,
}: {
  params: Promise<{ hostId: string; orderId: string }>;
}) {
  const { hostId, orderId } = use(params);
  // Cliente: token viene de ?t=... Sin token no podemos cargar la orden.
  const [info, setInfo] = useState<OrderInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidNow, setPaidNow] = useState(false);
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const sdkLoaded = useRef(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    setToken(t);
  }, []);

  const fetchInfo = useCallback(async () => {
    if (!token) throw new Error("Token requerido");
    const r = await fetch(
      `/api/public/hub/${encodeURIComponent(hostId)}/service-order/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!r.ok) throw new Error(r.statusText);
    return (await r.json()) as OrderInfo;
  }, [hostId, orderId, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchInfo()
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar la orden");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchInfo, token]);

  // PayPal SDK loader + Smart Buttons
  useEffect(() => {
    if (!info?.paypal || !buttonsRef.current) return;
    if (info.order.paidAt || paidNow) return;
    if (sdkLoaded.current) return;
    sdkLoaded.current = true;

    const scriptId = "paypal-sdk-service-order";
    const renderButtons = () => {
      if (!window.paypal || !buttonsRef.current) return;
      buttonsRef.current.innerHTML = "";
      window.paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "pay" },
        createOrder: async () => {
          setPayError(null);
          setPaying(true);
          try {
            const r = await fetch(
              `/api/public/hub/${encodeURIComponent(hostId)}/service-order/${encodeURIComponent(orderId)}/paypal/create`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerToken: token }),
              },
            );
            const j = (await r.json()) as { orderId?: string; error?: string };
            if (!r.ok || !j.orderId) throw new Error(j.error ?? `HTTP ${r.status}`);
            return j.orderId;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Error iniciando pago";
            setPayError(msg);
            setPaying(false);
            throw err;
          }
        },
        onApprove: async (data: { orderID: string }) => {
          try {
            const r = await fetch(
              `/api/public/hub/${encodeURIComponent(hostId)}/service-order/${encodeURIComponent(orderId)}/paypal/capture`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerToken: token, paypalOrderId: data.orderID }),
              },
            );
            const j = (await r.json()) as { ok?: boolean; error?: string };
            if (!r.ok || !j.ok) throw new Error(j.error ?? "No se pudo capturar el pago");
            setPaidNow(true);
            // Refresh para mostrar el state final.
            const fresh = await fetchInfo();
            setInfo(fresh);
          } catch (err) {
            setPayError(err instanceof Error ? err.message : "Error capturando pago");
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

    const existing = document.getElementById(scriptId);
    if (existing) {
      renderButtons();
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      info.paypal.clientId,
    )}&currency=${encodeURIComponent(info.order.currency)}&intent=capture`;
    script.async = true;
    script.onload = renderButtons;
    script.onerror = () => setPayError("No se pudo cargar PayPal");
    document.body.appendChild(script);
  }, [info, paidNow, hostId, orderId, token, fetchInfo]);

  if (loading || token === null) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </main>
    );
  }

  if (error || !info) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 mx-auto mb-4 text-rose-400" />
          <h1 className="text-2xl font-bold mb-2">No se pudo cargar la orden</h1>
          <p className="text-slate-600">{error ?? "Orden no encontrada"}</p>
          <Button asChild className="mt-6">
            <Link href={`/hub/${hostId}`}>Volver al hub</Link>
          </Button>
        </div>
      </main>
    );
  }

  const isPaid = info.order.paidAt !== null || paidNow;
  const waLink = info.host.whatsapp
    ? `https://wa.me/${info.host.whatsapp.replace(/\D/g, "")}`
    : null;

  return (
    <main className="min-h-screen bg-[#FDFBF7] py-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {info.host.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.host.logo}
              alt={info.host.name}
              className="h-16 w-16 rounded-full mx-auto mb-4 border-4 border-white shadow-lg object-cover"
            />
          )}
          <h1 className="text-3xl font-bold">{info.host.name}</h1>
          <p className="text-slate-500 mt-1">
            {isPaid ? "Tu reserva está confirmada" : "Confirmá y pagá tu reserva"}
          </p>
        </div>

        {/* Status post-pago */}
        {isPaid && (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-6 mb-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600 mb-3" />
            <h2 className="text-xl font-bold text-emerald-900 mb-1">¡Pago confirmado!</h2>
            <p className="text-sm text-emerald-700">
              El host y el proveedor del servicio fueron notificados.
            </p>
            {info.order.paymentId && (
              <p className="text-[10px] text-emerald-600 mt-3 font-mono">
                Pago: {info.order.paymentId}
              </p>
            )}
          </div>
        )}

        {/* Sprint 6 — QR + PIN para que el huésped valide la entrega con el
            vendor. Solo se muestra cuando la orden está pagada y todavía no
            fue redimida. Si ya se entregó, mostramos confirmación cerrada. */}
        {isPaid && info.order.redemptionToken && info.order.redemptionPin && (
          <div className="bg-white rounded-2xl shadow-md border-2 border-amber-200 p-6 mb-6">
            <h2 className="font-bold text-lg mb-1 flex items-center gap-2">
              <QrCode className="h-5 w-5 text-amber-600" /> Tu pase de entrega
            </h2>
            <p className="text-xs text-slate-500 mb-5">
              Mostrale este código o dictá el PIN al proveedor a la llegada para validar el servicio.
            </p>

            {info.order.redeemedAt ? (
              <div className="text-center py-6 bg-emerald-50 rounded-xl border border-emerald-200">
                <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600 mb-2" />
                <p className="font-bold text-emerald-900">Servicio entregado</p>
                <p className="text-[11px] text-emerald-700 mt-1">
                  {new Date(info.order.redeemedAt).toLocaleString("es-ES", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            ) : (
              <>
                {/* QR grande centrado. Codifica una URL absoluta al portal
                    del vendor — cuando el vendor escanea, abre el portal con
                    el token cargado y listo para confirmar. */}
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-white border-2 border-slate-200 rounded-2xl shadow-sm">
                    <QRCodeSVG
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/v/${info.order.redemptionToken}`}
                      size={200}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                </div>

                {/* PIN como fallback dictable. Tamaño grande para que sea
                    legible al mostrar la pantalla a un proveedor. */}
                <div className="text-center pt-4 border-t">
                  <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center justify-center gap-1.5">
                    <Hash className="h-3 w-3" /> O dictá este código
                  </p>
                  <p className="text-4xl font-mono font-extrabold tracking-[0.3em] text-slate-900">
                    {info.order.redemptionPin}
                  </p>
                </div>

                {/* Estado del vendor — el huésped sabe qué espera */}
                {VENDOR_STATUS_LABELS[info.order.vendorStatus] && (
                  <div
                    className={`mt-5 p-3 rounded-lg border text-sm text-center ${VENDOR_STATUS_LABELS[info.order.vendorStatus].cls}`}
                  >
                    {VENDOR_STATUS_LABELS[info.order.vendorStatus].es}
                  </div>
                )}

                {/* Sprint 7.5 — WhatsApp click-to-chat al/los vendor(es).
                    Vendors en Punta Cana no chequean email seguido. El
                    huésped puede mandarles WhatsApp con un click pasando
                    todos los datos + link al portal en el mensaje. */}
                {info.order.vendorStatus === "awaiting" && (() => {
                  // Agrupar items por vendor único (por phone). Mostrar 1 botón por vendor.
                  const vendorsWithPhone = new Map<string, { name: string; phone: string; items: typeof info.order.items }>();
                  for (const it of info.order.items) {
                    if (!it.vendor?.phone) continue;
                    const key = it.vendor.phone;
                    const existing = vendorsWithPhone.get(key);
                    if (existing) {
                      existing.items.push(it);
                    } else {
                      vendorsWithPhone.set(key, {
                        name: it.vendor.name,
                        phone: it.vendor.phone,
                        items: [it],
                      });
                    }
                  }
                  const vendorList = Array.from(vendorsWithPhone.values());
                  if (vendorList.length === 0) return null;

                  return (
                    <div className="mt-5 pt-5 border-t space-y-2">
                      <p className="text-[11px] uppercase tracking-widest text-slate-500 text-center mb-2 flex items-center justify-center gap-1.5">
                        <MessageCircle className="h-3 w-3" /> Avisá a tu proveedor por WhatsApp
                      </p>
                      {vendorList.map((v) => {
                        const itemsLabel = v.items.map((it) => `• ${it.name}${it.serviceDate ? ` (${it.serviceDate})` : ""}`).join("\n");
                        const manageUrl = info.order.redemptionToken && info.order.vendorActionToken
                          ? `${typeof window !== "undefined" ? window.location.origin : ""}/v/${info.order.redemptionToken}?k=${info.order.vendorActionToken}`
                          : "";
                        const message = [
                          `¡Hola! Soy ${info.order.guestName}, ya pagué la reserva:`,
                          "",
                          itemsLabel,
                          "",
                          `PIN: ${info.order.redemptionPin ?? ""}`,
                          manageUrl ? `Detalles: ${manageUrl}` : "",
                          "",
                          "¿Confirmamos?",
                        ].filter(Boolean).join("\n");
                        const waLink = `https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
                        return (
                          <Button
                            key={v.phone}
                            asChild
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                            size="lg"
                          >
                            <a href={waLink} target="_blank" rel="noopener noreferrer">
                              <MessageCircle className="h-4 w-4 mr-2" />
                              Avisar a {v.name}
                            </a>
                          </Button>
                        );
                      })}
                      <p className="text-[10px] text-slate-500 text-center italic">
                        Esto le manda los datos completos y el link para que confirme directo desde su celular.
                      </p>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* Resumen orden */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-amber-600" /> Resumen
          </h2>
          <div className="space-y-3">
            {info.order.items.map((it) => {
              const suffix = PRICING_SUFFIX[it.pricingModel] ?? "";
              const qtyLabel =
                it.pricingModel === "fixed"
                  ? it.quantity > 1
                    ? ` × ${it.quantity}`
                    : ""
                  : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;
              return (
                <div key={it.id} className="flex justify-between items-start py-2 border-b last:border-0">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="font-semibold text-sm">
                      {it.name}
                      <span className="font-normal text-slate-500">{qtyLabel}</span>
                    </p>
                    {it.serviceDate && (
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        <Calendar className="h-3 w-3" /> {it.serviceDate}
                      </p>
                    )}
                  </div>
                  <p className="font-bold text-sm whitespace-nowrap">
                    {formatMoney(it.lineTotal, info.order.currency)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center pt-4 mt-4 border-t-2">
            <span className="font-bold">Total</span>
            <span className="text-2xl font-extrabold">
              {formatMoney(info.order.total, info.order.currency)}
            </span>
          </div>
        </div>

        {/* Nombre del huésped (sólo nombre — email/phone no se devuelven
            por privacidad; el huésped ya los conoce). */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6 text-sm">
          <h3 className="font-bold mb-2">Datos de contacto</h3>
          <p className="text-slate-700">{info.order.guestName}</p>
        </div>

        {/* Pago */}
        {!isPaid && (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold mb-4 text-center">Pagar con PayPal</h3>
            {info.paypal ? (
              <>
                <div id="paypal-buttons" ref={buttonsRef} className="min-h-[50px]" />
                {paying && (
                  <p className="text-center text-sm text-slate-500 mt-3">
                    <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Procesando...
                  </p>
                )}
                {payError && (
                  <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
                    {payError}
                  </div>
                )}
                {info.paypal.mode === "sandbox" && (
                  <p className="text-[10px] text-center text-amber-600 mt-3 italic">
                    Sandbox PayPal — sin cargo real
                  </p>
                )}
              </>
            ) : (
              <div className="text-center text-sm text-slate-600">
                <AlertCircle className="h-8 w-8 mx-auto text-amber-500 mb-2" />
                <p>El host no tiene PayPal habilitado. Contactalo para coordinar el pago manual:</p>
                <div className="mt-4 flex flex-col gap-2">
                  {waLink && (
                    <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <a href={waLink} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
                      </a>
                    </Button>
                  )}
                  {info.host.contactEmail && (
                    <Button asChild variant="outline">
                      <a href={`mailto:${info.host.contactEmail}`}>
                        <Mail className="h-4 w-4 mr-2" /> {info.host.contactEmail}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-8">
          <Button asChild variant="ghost" className="text-slate-500">
            <Link href={`/hub/${hostId}`}>
              <Home className="h-4 w-4 mr-2" /> Volver al hub
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
