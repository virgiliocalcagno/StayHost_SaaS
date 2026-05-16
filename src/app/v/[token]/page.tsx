"use client";

/**
 * /v/[token] — portal del vendor para gestionar una orden.
 *
 * El token es service_orders.redemption_token (32-char hex). Es el mismo
 * que va en el QR del huésped y en el email del vendor. Página pública —
 * cualquiera con el token la ve.
 *
 * Acciones (confirmar/declinar/entregar) requieren `?k=<action_token>` en
 * la URL — eso lo único que tiene el vendor real (vino en su email). Sin
 * `k`, página en modo read-only: muestra detalle pero no botones.
 *
 * "Marcar entregada" requiere además el PIN del huésped (presencia física).
 */

import { use, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  Clock,
  MapPin,
  Plane,
  ShieldCheck,
  Bell,
  BellOff,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";

type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  pricingModel: string;
  unitPrice: number;
  lineTotal: number;
  serviceDate: string | null;
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
  extraNotes: string | null;
  vendor: { name: string; phone: string | null } | null;
};

type OrderInfo = {
  canAct: boolean;
  order: {
    id: string;
    status: string;
    vendorStatus: string;
    paidAt: string | null;
    redeemedAt: string | null;
    vendorConfirmedAt: string | null;
    vendorDeclinedAt: string | null;
    vendorDeclineReason: string | null;
    total: number;
    currency: string;
    guestName: string;
    guestPhone: string | null;
    guestEmail: string | null;
    items: OrderItem[];
  };
  host: {
    name: string;
    whatsapp: string | null;
    email: string | null;
    logo: string | null;
  };
};

const PRICING_SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

// VAPID public key viene en base64url (RFC 7515). El browser quiere
// Uint8Array, así que decodificamos manualmente.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const VENDOR_STATUS_BADGE: Record<string, { label: string; cls: string; icon: string }> = {
  awaiting: { label: "Aguardando confirmación", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: "⏳" },
  confirmed: { label: "Confirmada", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: "✓" },
  declined: { label: "Declinada", cls: "bg-rose-100 text-rose-800 border-rose-200", icon: "✗" },
  delivered: { label: "Entregada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "✅" },
  no_show: { label: "No-show", cls: "bg-slate-100 text-slate-700 border-slate-200", icon: "❌" },
};

export default function VendorRedeemPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const search = useSearchParams();
  const actionToken = search.get("k") ?? "";

  const [info, setInfo] = useState<OrderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<null | "confirm" | "decline" | "deliver">(null);
  const [pinInput, setPinInput] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Sprint 7.5 — push notifications state.
  const [pushStatus, setPushStatus] = useState<
    "checking" | "unsupported" | "denied" | "available" | "subscribed" | "subscribing" | "error"
  >("checking");
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  // Sprint 7.5 — chequear soporte de push notifications al cargar.
  // Si el browser no soporta, push permanece 'unsupported' y no mostramos
  // el prompt. Si soporta + permiso ya concedido + subscription activa,
  // marcamos 'subscribed'.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPushStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPushStatus("denied");
        return;
      }
      // Registrar el SW (idempotente — si ya está registrado, el browser
      // devuelve la registration existente sin re-instalar).
      try {
        const reg = await navigator.serviceWorker.register("/sw-vendor.js", { scope: "/" });
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          if (!cancelled) setPushStatus("subscribed");
        } else {
          if (!cancelled) setPushStatus("available");
        }
      } catch (e) {
        console.error("[push] SW register failed:", e);
        if (!cancelled) setPushStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe: pide permiso, genera subscription, manda al server con el
  // actionToken para que el server resuelva el vendor.
  const handleEnablePush = useCallback(async () => {
    if (!actionToken) {
      setPushMessage("Abrí el link único desde tu email para activar notificaciones.");
      return;
    }
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setPushMessage("Push no configurado en el servidor (sin VAPID).");
      setPushStatus("error");
      return;
    }
    setPushStatus("subscribing");
    setPushMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "denied" : "available");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast a BufferSource — el tipo TS estricto no acepta Uint8Array<ArrayBufferLike>
        // pero la spec del browser lo acepta sin problema.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      // POST al server con redemption_token + action_token para auth.
      const r = await fetch("/api/vendor/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redemptionToken: token,
          actionToken,
          subscription: sub.toJSON(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setPushStatus("subscribed");
      setPushMessage("¡Listo! Te llegarán notificaciones al instante.");
    } catch (e) {
      console.error("[push] subscribe failed:", e);
      setPushStatus("error");
      setPushMessage(e instanceof Error ? e.message : "No se pudo activar");
    }
  }, [actionToken, token]);

  const fetchInfo = useCallback(async () => {
    const url = `/api/public/redeem/${encodeURIComponent(token)}${actionToken ? `?k=${encodeURIComponent(actionToken)}` : ""}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? r.statusText);
    }
    return (await r.json()) as OrderInfo;
  }, [token, actionToken]);

  useEffect(() => {
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
  }, [fetchInfo]);

  const runAction = async (action: "confirm" | "decline" | "deliver") => {
    if (acting) return;
    setActing(action);
    setActionError(null);
    try {
      const body: Record<string, unknown> = { action, actionToken };
      if (action === "decline") body.declineReason = declineReason.trim() || null;
      if (action === "deliver") body.pin = pinInput.trim().toUpperCase();
      const r = await fetch(`/api/public/redeem/${encodeURIComponent(token)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setActionError(j.error ?? "No se pudo procesar la acción");
        return;
      }
      // Refresh para mostrar el nuevo estado.
      const fresh = await fetchInfo();
      setInfo(fresh);
      setPinInput("");
      setDeclineReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </main>
    );
  }

  if (error || !info) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertCircle className="h-14 w-14 mx-auto mb-3 text-rose-400" />
          <h1 className="text-2xl font-bold mb-2">No se pudo cargar</h1>
          <p className="text-slate-600 text-sm">{error ?? "Orden no encontrada"}</p>
        </div>
      </main>
    );
  }

  const { order, host, canAct } = info;
  const badge = VENDOR_STATUS_BADGE[order.vendorStatus] ?? VENDOR_STATUS_BADGE.awaiting;
  const isFinal = order.vendorStatus === "delivered" || order.vendorStatus === "declined";

  // WhatsApp del host para reportar problemas que no podés resolver desde el portal.
  const hostWaLink = host.whatsapp ? `https://wa.me/${host.whatsapp.replace(/\D/g, "")}` : null;

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      {/* Header con logo del host */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          {host.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={host.logo} alt={host.name} className="h-10 w-10 rounded-full object-cover border-2 border-white shadow" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Portal del proveedor</p>
            <p className="font-bold truncate">{host.name}</p>
          </div>
          <Badge className={`text-[10px] ${badge.cls}`}>
            {badge.icon} {badge.label}
          </Badge>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 pt-6 space-y-5">
        {/* Banner read-only si no tiene action_token */}
        {!canAct && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-amber-900">Modo solo lectura</p>
              <p className="text-amber-800 mt-1">
                Esta vista es pública. Para confirmar, declinar o marcar entregada esta orden, abrila desde el link único que recibiste en tu email.
              </p>
            </div>
          </div>
        )}

        {/* Sprint 7.5 — banner para activar push notifications. Solo si:
            - canAct (vendor real con action_token)
            - browser soporta
            - todavía no está subscripto */}
        {canAct && (pushStatus === "available" || pushStatus === "subscribing") && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-4 flex items-start gap-3">
            <Bell className="h-6 w-6 text-blue-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-blue-900">No te pierdas ninguna orden</p>
              <p className="text-xs text-blue-700 mt-1">
                Activá las notificaciones para recibir un ping al instante cuando llegue una nueva reserva, aunque tengas el celular cerrado.
              </p>
              <Button
                size="sm"
                className="mt-3 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleEnablePush}
                disabled={pushStatus === "subscribing"}
              >
                {pushStatus === "subscribing" ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <Bell className="h-3 w-3 mr-1.5" />
                )}
                Activar notificaciones
              </Button>
              {pushMessage && <p className="text-[11px] text-rose-700 mt-2">{pushMessage}</p>}
            </div>
          </div>
        )}

        {canAct && pushStatus === "subscribed" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-900">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">Notificaciones activadas en este dispositivo.</span>
          </div>
        )}

        {canAct && pushStatus === "denied" && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-900">
            <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Bloqueaste las notificaciones para este sitio. Si querés recibir órdenes al instante, habilitalas en la configuración del navegador.
            </p>
          </div>
        )}

        {/* Datos del huésped — el dato más importante para coordinar */}
        <section className="bg-white rounded-2xl border shadow-sm p-5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Huésped</p>
          <p className="text-xl font-bold">{order.guestName}</p>
          {(order.guestPhone || order.guestEmail) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {order.guestPhone && (
                <a
                  href={`https://wa.me/${order.guestPhone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                >
                  <MessageCircle className="h-3 w-3" /> {order.guestPhone}
                </a>
              )}
              {order.guestPhone && (
                <a
                  href={`tel:${order.guestPhone}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                >
                  <Phone className="h-3 w-3" /> Llamar
                </a>
              )}
              {order.guestEmail && (
                <a
                  href={`mailto:${order.guestEmail}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
                >
                  <Mail className="h-3 w-3" /> {order.guestEmail}
                </a>
              )}
            </div>
          )}
        </section>

        {/* Items con toda la info operativa */}
        <section className="bg-white rounded-2xl border shadow-sm p-5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Servicios a entregar</p>
          <div className="space-y-3">
            {order.items.map((it) => {
              const suffix = PRICING_SUFFIX[it.pricingModel] ?? "";
              const qtyLabel = it.pricingModel === "fixed"
                ? (it.quantity > 1 ? ` × ${it.quantity}` : "")
                : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;
              return (
                <div key={it.id} className="p-3 bg-slate-50 rounded-xl border">
                  <div className="flex justify-between gap-2 items-start">
                    <p className="font-bold text-sm">
                      {it.name}<span className="font-normal text-slate-500">{qtyLabel}</span>
                    </p>
                    <p className="font-bold text-sm whitespace-nowrap">
                      {formatMoney(it.lineTotal, order.currency)}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    {it.serviceDate && (
                      <p className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" /> {it.serviceDate}
                        {it.serviceTime && (
                          <>
                            <span className="text-slate-300">·</span>
                            <Clock className="h-3 w-3" /> {it.serviceTime}
                          </>
                        )}
                      </p>
                    )}
                    {it.pickupLocation && (
                      <p className="flex items-start gap-1.5">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{it.pickupLocation}</span>
                      </p>
                    )}
                    {it.flightNumber && (
                      <p className="flex items-center gap-1.5">
                        <Plane className="h-3 w-3" />
                        <span className="font-mono font-semibold">{it.flightNumber}</span>
                        <a
                          href={`https://www.google.com/search?q=vuelo+${encodeURIComponent(it.flightNumber)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:underline"
                        >
                          tracking ↗
                        </a>
                      </p>
                    )}
                    {it.extraNotes && (
                      <p className="bg-amber-50 border border-amber-200 rounded p-2 italic text-amber-900 mt-2">
                        💬 {it.extraNotes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center pt-4 mt-4 border-t-2">
            <span className="text-sm font-bold">Total cobrado</span>
            <span className="text-xl font-extrabold">{formatMoney(order.total, order.currency)}</span>
          </div>
        </section>

        {/* Banner de decline si aplica */}
        {order.vendorStatus === "declined" && order.vendorDeclinedAt && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-rose-900">
              ✗ Esta orden fue declinada {new Date(order.vendorDeclinedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
            </p>
            {order.vendorDeclineReason && (
              <p className="text-rose-800 mt-1 italic">&ldquo;{order.vendorDeclineReason}&rdquo;</p>
            )}
            <p className="text-rose-700 mt-2 text-xs">
              El host fue notificado para reasignar o reembolsar al huésped.
            </p>
          </div>
        )}

        {/* Banner de delivered */}
        {order.vendorStatus === "delivered" && order.redeemedAt && (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600 mb-2" />
            <p className="font-bold text-emerald-900">✅ Servicio entregado</p>
            <p className="text-xs text-emerald-700 mt-1">
              {new Date(order.redeemedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
            </p>
          </div>
        )}

        {/* Acciones — solo si canAct y no estado final */}
        {canAct && !isFinal && (
          <section className="bg-white rounded-2xl border shadow-sm p-5 space-y-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Tu próxima acción</p>

            {/* awaiting → confirmar o declinar */}
            {order.vendorStatus === "awaiting" && (
              <>
                <Button
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!!acting}
                  onClick={() => runAction("confirm")}
                >
                  {acting === "confirm" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Confirmo, voy a entregar
                </Button>

                <div className="pt-3 border-t">
                  <p className="text-xs text-slate-500 mb-2">No podés atender esta orden?</p>
                  <Input
                    type="text"
                    placeholder="Motivo (opcional, lo ve el host)"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    maxLength={500}
                    className="mb-2 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-rose-600 border-rose-200 hover:bg-rose-50"
                    disabled={!!acting}
                    onClick={() => {
                      if (confirm("¿Seguro que querés declinar esta orden? El host va a tener que reasignar o reembolsar al huésped.")) {
                        runAction("decline");
                      }
                    }}
                  >
                    {acting === "decline" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                    Declinar
                  </Button>
                </div>
              </>
            )}

            {/* confirmed (o awaiting si urge) → marcar entregada con PIN */}
            {(order.vendorStatus === "confirmed" || order.vendorStatus === "awaiting") && (
              <div className="pt-3 border-t space-y-3">
                <div>
                  <Label htmlFor="pin" className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    PIN del huésped (6 caracteres)
                  </Label>
                  <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
                    Pedile al huésped que te lo dicte o muestre el QR de su pase.
                  </p>
                  <Input
                    id="pin"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                    maxLength={6}
                    placeholder="H4P9K2"
                    className="text-center text-2xl font-mono font-bold tracking-[0.3em]"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                  />
                </div>
                <Button
                  size="lg"
                  className="w-full gradient-gold text-white"
                  disabled={!!acting || pinInput.length !== 6}
                  onClick={() => runAction("deliver")}
                >
                  {acting === "deliver" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Marcar entregada
                </Button>
              </div>
            )}

            {actionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
                {actionError}
              </div>
            )}
          </section>
        )}

        {/* Contacto host como fallback */}
        {hostWaLink && (
          <section className="bg-slate-100 rounded-2xl p-4 text-center">
            <p className="text-xs text-slate-500 mb-2">¿Algún problema con la orden?</p>
            <Button asChild variant="outline" size="sm">
              <a href={hostWaLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-3 w-3 mr-1.5" />
                Contactar al host por WhatsApp
              </a>
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
