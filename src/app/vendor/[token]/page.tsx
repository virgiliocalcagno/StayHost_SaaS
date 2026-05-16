"use client";

/**
 * /vendor/[token] — Portal permanente del vendor.
 *
 * El token es upsell_vendors.portal_token (32-char hex permanente, no
 * expira). El vendor lo recibe por email al ser creado y lo guarda como
 * bookmark / PWA instalada. Una sola URL para:
 *   - Ver TODAS sus órdenes pasadas + nuevas
 *   - Confirmar / declinar / marcar entregadas
 *   - Activar notificaciones push (sin esperar primera orden)
 *   - Instalar app (PWA)
 *
 * Esta página reemplaza el portal viejo /v/[token] como punto de entrada
 * principal del vendor. /v/[token] sigue funcionando como deep-link a una
 * orden específica desde un email.
 */

import { use, useEffect, useState, useCallback, useMemo } from "react";
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
  Bell,
  BellOff,
  Download,
  Share,
  X,
  ChevronDown,
  ChevronUp,
  ShoppingBag,
  Star,
  TrendingUp,
  Package,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import { usePwaInstall } from "@/lib/pwa/use-install-prompt";

type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  pricingModel: string;
  serviceDate: string | null;
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
  extraNotes: string | null;
};

type VendorOrder = {
  id: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  status: string;
  vendorStatus: string;
  myTotal: number;
  currency: string;
  paidAt: string | null;
  createdAt: string;
  redeemedAt: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  declineReason: string | null;
  guestPin: string | null;
  items: OrderItem[];
};

type PortalData = {
  vendor: {
    id: string;
    name: string;
    legalName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    heroPhoto: string | null;
    description: string | null;
    category: string;
    rating: number | null;
    totalOrders: number;
    active: boolean;
    notificationChannels: string[];
  };
  host: { name: string; logoUrl: string | null };
  stats: {
    ordersThisMonth: number;
    pendingCount: number;
    confirmedCount: number;
    deliveredThisMonth: number;
    revenueThisMonth: number;
    currency: string;
  };
  orders: VendorOrder[];
};

const PRICING_SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

const STATUS_TABS = [
  { key: "awaiting", label: "Pendientes", badgeClass: "bg-amber-500" },
  { key: "confirmed", label: "Confirmadas", badgeClass: "bg-blue-500" },
  { key: "delivered", label: "Entregadas", badgeClass: "bg-emerald-500" },
  { key: "all", label: "Todas", badgeClass: "bg-slate-500" },
] as const;

type TabKey = (typeof STATUS_TABS)[number]["key"];

// VAPID public key viene en base64url. El browser quiere Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function VendorPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const pwa = usePwaInstall();

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("awaiting");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Action state per order — disabled mientras procesa, último mensaje.
  const [actionState, setActionState] = useState<
    Record<string, { kind: "idle" | "saving" } | { kind: "err"; msg: string }>
  >({});
  const [pinInput, setPinInput] = useState<Record<string, string>>({});
  const [declineInput, setDeclineInput] = useState<Record<string, string>>({});
  const [declineOpen, setDeclineOpen] = useState<string | null>(null);

  // Push subscription state.
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    typeof window === "undefined" || typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [pushSubscribing, setPushSubscribing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // Cargar data del portal.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/portal/${token}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as PortalData;
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Filtrar órdenes por tab.
  const filteredOrders = useMemo(() => {
    if (!data) return [];
    if (tab === "all") return data.orders;
    return data.orders.filter((o) => o.vendorStatus === tab);
  }, [data, tab]);

  // ── Acciones sobre orden ────────────────────────────────────────────────
  const runAction = useCallback(
    async (orderId: string, action: "confirm" | "decline" | "deliver") => {
      setActionState((prev) => ({ ...prev, [orderId]: { kind: "saving" } }));
      try {
        const body: Record<string, unknown> = { action };
        if (action === "decline") {
          body.declineReason = declineInput[orderId]?.trim() || undefined;
        }
        if (action === "deliver") {
          const pin = pinInput[orderId]?.trim() ?? "";
          if (!pin) throw new Error("Ingresá el PIN del huésped (6 caracteres)");
          body.pin = pin;
        }
        const res = await fetch(
          `/api/vendor/portal/${token}/order/${orderId}/action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        setActionState((prev) => ({ ...prev, [orderId]: { kind: "idle" } }));
        setDeclineOpen(null);
        setDeclineInput((prev) => ({ ...prev, [orderId]: "" }));
        setPinInput((prev) => ({ ...prev, [orderId]: "" }));
        await reload();
      } catch (e) {
        setActionState((prev) => ({
          ...prev,
          [orderId]: { kind: "err", msg: (e as Error).message },
        }));
      }
    },
    [token, pinInput, declineInput, reload],
  );

  // ── Push subscription ────────────────────────────────────────────────────
  const enablePush = useCallback(async () => {
    setPushSubscribing(true);
    setPushError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Este browser no soporta notificaciones push.");
      }
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error("VAPID key no configurada. Avisá al host.");
      }

      // Registrar SW si no está. /sw-vendor.js maneja eventos push.
      const reg = await navigator.serviceWorker.register("/sw-vendor.js", {
        scope: "/",
      });

      // Pedir permiso si todavía no se pidió.
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      if (perm !== "granted") {
        throw new Error("Permiso de notificaciones denegado.");
      }

      // Crear/obtener subscription.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
      }

      // Mandar al server para guardar.
      const res = await fetch(`/api/vendor/portal/${token}/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: {
            endpoint: sub.endpoint,
            keys: {
              p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
              auth: arrayBufferToBase64(sub.getKey("auth")),
            },
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setPushError((e as Error).message);
    } finally {
      setPushSubscribing(false);
    }
  }, [token]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold">Portal no disponible</h1>
          <p className="text-sm text-muted-foreground">
            {error ?? "No pudimos cargar tu portal. Verificá el link o pedile uno nuevo al host."}
          </p>
        </div>
      </div>
    );
  }

  const { vendor, host, stats, orders } = data;
  const counts = {
    awaiting: orders.filter((o) => o.vendorStatus === "awaiting").length,
    confirmed: orders.filter((o) => o.vendorStatus === "confirmed").length,
    delivered: orders.filter((o) => o.vendorStatus === "delivered").length,
    all: orders.length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center gap-3">
          {vendor.heroPhoto ? (
            <img
              src={vendor.heroPhoto}
              alt={vendor.name}
              className="h-12 w-12 rounded-full object-cover border-2 border-white/40"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-lg font-bold">
              {vendor.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg leading-tight truncate">{vendor.name}</h1>
            <p className="text-xs text-amber-100 truncate">
              Trabajás con {host.name}
            </p>
          </div>
          {vendor.rating != null && vendor.totalOrders > 0 && (
            <div className="text-right text-xs">
              <div className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-current" />
                <span className="font-bold">{Number(vendor.rating).toFixed(1)}</span>
              </div>
              <p className="text-amber-100">{vendor.totalOrders} órdenes</p>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Setup banner: push + PWA. Solo se muestra si hay algo por hacer. */}
        {(pushPermission === "default" ||
          pushPermission === "denied" ||
          pwa.state === "native" ||
          pwa.state === "ios-manual") && (
          <div className="bg-white rounded-xl border-2 border-amber-300 p-4 space-y-3 shadow-sm">
            <h3 className="font-semibold flex items-center gap-2 text-sm">
              <Bell className="h-4 w-4 text-amber-600" /> Configurá tu portal
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {pushPermission === "default" && (
                <button
                  onClick={enablePush}
                  disabled={pushSubscribing}
                  className="text-left p-3 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    {pushSubscribing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                    Activar notificaciones
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Te avisamos al instante cuando llega un nuevo pedido.
                  </p>
                </button>
              )}
              {pushPermission === "denied" && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <BellOff className="h-4 w-4 text-red-600" /> Notifs bloqueadas
                  </div>
                  <p className="text-[11px] text-red-700 mt-1">
                    Activá los permisos del browser para esta página y recargá.
                  </p>
                </div>
              )}

              {pwa.state === "native" && (
                <button
                  onClick={pwa.promptInstall}
                  className="text-left p-3 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition"
                >
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <Download className="h-4 w-4" /> Instalar app
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Abrí el portal desde el ícono de tu celular, fullscreen.
                  </p>
                </button>
              )}
              {pwa.state === "ios-manual" && (
                <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <Share className="h-4 w-4 text-blue-600" /> Instalar en iPhone
                  </div>
                  <p className="text-[11px] text-blue-700 mt-1">
                    Tocá <strong>Compartir</strong> en Safari → <strong>Agregar a inicio</strong>.
                  </p>
                </div>
              )}
            </div>
            {pushError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {pushError}
              </p>
            )}
          </div>
        )}

        {/* Si ya está todo configurado, mostramos un ribbon compacto. */}
        {pushPermission === "granted" && pwa.state === "installed" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 px-3 flex items-center gap-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Portal listo: notificaciones activas + app instalada.
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard
            icon={<Package className="h-4 w-4" />}
            label="Pendientes"
            value={stats.pendingCount}
            tint="amber"
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Confirmadas"
            value={stats.confirmedCount}
            tint="blue"
          />
          <StatCard
            icon={<ShoppingBag className="h-4 w-4" />}
            label="Entregadas mes"
            value={stats.deliveredThisMonth}
            tint="emerald"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Ingresos mes"
            value={formatMoney(stats.revenueThisMonth, stats.currency)}
            tint="violet"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {STATUS_TABS.map((t) => {
            const count = counts[t.key];
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                }`}
              >
                {t.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] ${
                    active ? "bg-white/20" : t.badgeClass + " text-white"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Orders list */}
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-dashed">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {tab === "all"
                ? "Todavía no hay órdenes asignadas a vos."
                : `No hay órdenes ${STATUS_TABS.find((t) => t.key === tab)?.label.toLowerCase()}.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredOrders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
                actionState={actionState[o.id] ?? { kind: "idle" }}
                pinValue={pinInput[o.id] ?? ""}
                setPin={(v) => setPinInput((prev) => ({ ...prev, [o.id]: v }))}
                declineValue={declineInput[o.id] ?? ""}
                setDecline={(v) => setDeclineInput((prev) => ({ ...prev, [o.id]: v }))}
                declineOpen={declineOpen === o.id}
                toggleDecline={() =>
                  setDeclineOpen(declineOpen === o.id ? null : o.id)
                }
                onAction={(a) => runAction(o.id, a)}
              />
            ))}
          </div>
        )}

        {/* Footer info */}
        <div className="text-center text-[11px] text-muted-foreground py-6">
          ¿Problemas? Hablá con <strong>{host.name}</strong>.
        </div>
      </main>
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tint: "amber" | "blue" | "emerald" | "violet";
}) {
  const tintClasses = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  }[tint];
  return (
    <div className={`rounded-xl border p-3 ${tintClasses}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {icon} {label}
      </div>
      <p className="text-lg font-bold mt-1">{value}</p>
    </div>
  );
}

function statusBadge(vendorStatus: string) {
  switch (vendorStatus) {
    case "awaiting":
      return { label: "Pendiente", className: "bg-amber-100 text-amber-800 border-amber-300" };
    case "confirmed":
      return { label: "Confirmada", className: "bg-blue-100 text-blue-800 border-blue-300" };
    case "delivered":
      return { label: "Entregada", className: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    case "declined":
      return { label: "Declinada", className: "bg-red-100 text-red-800 border-red-300" };
    case "cancelled":
      return { label: "Cancelada", className: "bg-slate-100 text-slate-700 border-slate-300" };
    default:
      return { label: vendorStatus, className: "bg-slate-100 text-slate-700 border-slate-300" };
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-DO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function OrderCard({
  order,
  expanded,
  onToggle,
  actionState,
  pinValue,
  setPin,
  declineValue,
  setDecline,
  declineOpen,
  toggleDecline,
  onAction,
}: {
  order: VendorOrder;
  expanded: boolean;
  onToggle: () => void;
  actionState: { kind: "idle" | "saving" } | { kind: "err"; msg: string };
  pinValue: string;
  setPin: (v: string) => void;
  declineValue: string;
  setDecline: (v: string) => void;
  declineOpen: boolean;
  toggleDecline: () => void;
  onAction: (a: "confirm" | "decline" | "deliver") => void;
}) {
  const badge = statusBadge(order.vendorStatus);
  const firstItem = order.items[0];
  const saving = actionState.kind === "saving";
  const errMsg = actionState.kind === "err" ? actionState.msg : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-slate-50 transition"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{order.guestName}</h3>
              <Badge className={`text-[10px] border ${badge.className}`}>
                {badge.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {firstItem?.name}
              {order.items.length > 1 && ` · +${order.items.length - 1} más`}
            </p>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
              {firstItem?.serviceDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{" "}
                  {new Date(firstItem.serviceDate).toLocaleDateString("es-DO", {
                    day: "numeric",
                    month: "short",
                  })}
                  {firstItem.serviceTime && ` · ${firstItem.serviceTime}`}
                </span>
              )}
              <span className="font-semibold text-foreground">
                {formatMoney(order.myTotal, order.currency)}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">
          {/* Datos del huésped */}
          <div className="flex flex-wrap gap-2 text-xs">
            {order.guestPhone && (
              <a
                href={`https://wa.me/${order.guestPhone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              >
                <MessageCircle className="h-3 w-3" /> {order.guestPhone}
              </a>
            )}
            {order.guestEmail && (
              <a
                href={`mailto:${order.guestEmail}`}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              >
                <Mail className="h-3 w-3" /> {order.guestEmail}
              </a>
            )}
          </div>

          {/* Items con todo el detalle */}
          <div className="space-y-2">
            {order.items.map((i) => (
              <div key={i.id} className="bg-white rounded-lg p-3 border border-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">
                      {i.name}{" "}
                      {i.pricingModel !== "fixed" && (
                        <span className="text-xs text-muted-foreground font-normal">
                          × {i.quantity} {PRICING_SUFFIX[i.pricingModel] ?? ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm font-bold whitespace-nowrap">
                    {formatMoney(i.lineTotal, order.currency)}
                  </p>
                </div>
                <div className="text-[11px] text-muted-foreground mt-2 space-y-0.5">
                  {i.serviceDate && (
                    <p className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {i.serviceDate}
                      {i.serviceTime && ` · `}
                      {i.serviceTime && <Clock className="h-3 w-3" />}
                      {i.serviceTime}
                    </p>
                  )}
                  {i.pickupLocation && (
                    <p className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {i.pickupLocation}
                    </p>
                  )}
                  {i.flightNumber && (
                    <p className="flex items-center gap-1">
                      <Plane className="h-3 w-3" /> Vuelo {i.flightNumber}
                    </p>
                  )}
                  {i.extraNotes && (
                    <p className="bg-amber-50 border-l-2 border-amber-400 px-2 py-1 mt-1 italic">
                      &ldquo;{i.extraNotes}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Timing info */}
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p>Pagada: {fmtDate(order.paidAt)}</p>
            {order.confirmedAt && <p>Confirmada: {fmtDate(order.confirmedAt)}</p>}
            {order.redeemedAt && <p>Entregada: {fmtDate(order.redeemedAt)}</p>}
            {order.declinedAt && (
              <p className="text-red-600">
                Declinada: {fmtDate(order.declinedAt)}
                {order.declineReason && ` · "${order.declineReason}"`}
              </p>
            )}
          </div>

          {/* Acciones según vendorStatus */}
          {order.vendorStatus === "awaiting" && (
            <div className="space-y-2 pt-2 border-t">
              {!declineOpen ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => onAction("confirm")}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Confirmar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={toggleDecline}
                    className="text-red-700 border-red-300 hover:bg-red-50 gap-2"
                  >
                    <XCircle className="h-4 w-4" /> Declinar
                  </Button>
                </div>
              ) : (
                <DeclineForm
                  value={declineValue}
                  onChange={setDecline}
                  onCancel={toggleDecline}
                  onConfirm={() => onAction("decline")}
                  saving={saving}
                />
              )}
            </div>
          )}

          {order.vendorStatus === "confirmed" && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">
                PIN del huésped (6 chars) — pedíselo al momento de la entrega
              </Label>
              <div className="flex gap-2">
                <Input
                  value={pinValue}
                  onChange={(e) => setPin(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={6}
                  className="font-mono uppercase text-center text-lg tracking-widest"
                />
                <Button
                  onClick={() => onAction("deliver")}
                  disabled={saving || pinValue.length < 6}
                  className="bg-emerald-600 hover:bg-emerald-700 gap-2 shrink-0"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Marcar entregada
                </Button>
              </div>
              {order.guestPin && (
                <p className="text-[10px] text-muted-foreground italic">
                  💡 PIN en sistema: <span className="font-mono font-bold">{order.guestPin}</span> (visible para
                  vendor — sirve si el huésped no se acuerda).
                </p>
              )}
            </div>
          )}

          {errMsg && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-2 text-xs text-red-800">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {errMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeclineForm({
  value,
  onChange,
  onCancel,
  onConfirm,
  saving,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">Motivo (opcional, lo ve el host)</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ej: ya tengo otra reserva para esa hora"
        maxLength={500}
      />
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1"
        >
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
        <Button
          onClick={onConfirm}
          disabled={saving}
          className="flex-1 bg-red-600 hover:bg-red-700"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4 mr-1" />
          )}
          Declinar
        </Button>
      </div>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
