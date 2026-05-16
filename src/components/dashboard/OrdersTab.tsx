"use client";

// Tab de Pedidos dentro del panel "Ventas Extras".
//
// Sprint 3 Fase B.2: el host ve todas las órdenes que llegaron del Hub,
// filtradas por estado. Puede:
//   - Ver detalle expandido (items + vendor + datos huésped)
//   - Marcar como completado (paid → completed)
//   - Cancelar pending no pagadas
//   - Marcar refunded (la devolución real la hace el host en PayPal)
//   - WhatsApp directo al vendor (para coordinar el servicio) y al huésped
//
// Vista por defecto: pending arriba (atención prioritaria), después paid,
// completed al final.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  Phone,
  Mail,
  MessageCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  MapPin,
  Plane,
  ExternalLink,
  Store,
  AlertCircle,
  Bell,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import { useHostPush } from "@/lib/push/use-host-push";

interface OrderItem {
  id: string;
  upsellId: string | null;
  vendorId: string | null;
  vendor: {
    name: string;
    phone: string | null;
    defaultPricingMethod: string;
    commissionPercent: number;
    defaultFixedCost: number | null;
    defaultFlatFee: number | null;
  } | null;
  name: string;
  pricingModel: string;
  unitPrice: number;
  quantity: number;
  serviceDate: string | null;
  lineTotal: number;
  // Sprint 5 — info del servicio capturada al checkout
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
  extraNotes: string | null;
}

interface Order {
  id: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  status: string;
  totalAmount: number;
  currency: string;
  paymentProvider: string | null;
  paymentId: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Datos de refund (Sprint 4 polish) — nulos hasta que se procese refund.
  refundedAt: string | null;
  refundAmount: number | null;
  refundPaymentId: string | null;
  refundNote: string | null;
  // Sprint 7 — estado del lado del vendor + razón de decline si aplica.
  vendorStatus: string | null;
  vendorDeclinedAt: string | null;
  vendorDeclineReason: string | null;
  // Sprint 8b — cancelación del huésped
  cancellationRequestedAt: string | null;
  cancellationRequestedBy: string | null;
  cancellationReason: string | null;
  cancellationDecidedAt: string | null;
  cancellationDecision: string | null;
  items: OrderItem[];
}

const STATUS_META: Record<string, { label: string; cls: string; emoji: string }> = {
  pending: { label: "Pendiente de pago", cls: "bg-amber-100 text-amber-800 border-amber-200", emoji: "⏳" },
  paid: { label: "Pagada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", emoji: "💰" },
  completed: { label: "Completada", cls: "bg-slate-100 text-slate-700 border-slate-200", emoji: "✅" },
  cancelled: { label: "Cancelada", cls: "bg-rose-50 text-rose-700 border-rose-200", emoji: "✖️" },
  refunded: { label: "Reembolsada", cls: "bg-purple-50 text-purple-700 border-purple-200", emoji: "↩️" },
};

const PRICING_SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

type FilterStatus = "all" | "pending" | "paid" | "completed" | "cancelled" | "refunded";

interface VendorOption {
  id: string;
  name: string;
  displayName: string | null;
  category: string;
  active: boolean;
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);

  // Sprint 7.8 — push notifications del host. Cuando vendor decline, llega
  // al instante; sin push solo email (lento).
  const hostPush = useHostPush();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, vRes] = await Promise.all([
        fetch("/api/service-orders", { cache: "no-store", credentials: "include" }),
        fetch("/api/upsell-vendors", { cache: "no-store", credentials: "include" }),
      ]);
      if (oRes.ok) {
        const j = (await oRes.json()) as { orders: Order[] };
        setOrders(j.orders ?? []);
      }
      if (vRes.ok) {
        const j = (await vRes.json()) as { vendors: VendorOption[] };
        setVendors(j.vendors ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      pending: 0, paid: 0, completed: 0, cancelled: 0, refunded: 0,
    };
    let revenuePaid = 0;
    for (const o of orders) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
      if (o.status === "paid" || o.status === "completed") revenuePaid += o.totalAmount;
    }
    return { counts, revenuePaid };
  }, [orders]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Transición allow-list — coincide con server-side de PATCH. Sirve para
  // decidir qué botones de cambio-de-status mostrar. "refunded" NO está en
  // esta lista porque ya no es un flip de estado — es una acción real via
  // POST /refund (botón aparte abajo cuando paymentProvider='paypal').
  const allowedTransitions = (status: string): string[] => {
    if (status === "pending") return ["cancelled"];
    if (status === "paid") return ["completed"];
    return [];
  };

  const updateStatus = async (orderId: string, newStatus: string, confirmMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setActing(orderId);
    try {
      const res = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "No se pudo actualizar");
        return;
      }
      await load();
    } finally {
      setActing(null);
    }
  };

  // Sprint 7 — Reasignar la orden a otro vendor cuando el actual declinó.
  // Confirma, hace POST al endpoint, recarga la lista. El email al nuevo
  // vendor se manda server-side automático (si su notification_pref lo permite).
  const reassignOrder = async (order: Order, newVendorId: string) => {
    const vendor = vendors.find((v) => v.id === newVendorId);
    if (!vendor) return;
    const vendorLabel = vendor.displayName ?? vendor.name;
    if (
      !confirm(
        `¿Reasignar esta orden a "${vendorLabel}"?\n\n` +
          `Se le va a mandar un email automático con el detalle y el link para gestionar (si tiene email + notificaciones activas).`,
      )
    ) {
      return;
    }
    setActing(order.id);
    try {
      const res = await fetch(`/api/service-orders/${order.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newVendorId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        emailSent?: boolean;
        channels?: string[];
        error?: string;
      };
      if (!res.ok || !j.ok) {
        alert(j.error ?? "No se pudo reasignar");
        return;
      }
      const ch = j.channels ?? [];
      const usedChannels = [];
      if (ch.includes("push")) usedChannels.push("push notification");
      if (j.emailSent) usedChannels.push("email");
      if (ch.includes("whatsapp_business")) usedChannels.push("WhatsApp Business");
      const summary = usedChannels.length > 0
        ? `Notificación enviada por: ${usedChannels.join(", ")}.`
        : "Sin canales auto habilitados — coordinala manual.";
      alert(`✓ Reasignada a ${vendorLabel}.\n\n${summary}`);
      await load();
    } finally {
      setActing(null);
    }
  };

  // Sprint 8b — decidir solicitud de cancelación del huésped.
  // approve → server hace refund automático con las credenciales del host.
  // reject → notif al huésped con motivo. La reserva sigue activa.
  const decideCancellation = async (order: Order, decision: "approve" | "reject") => {
    if (acting) return;
    const action = decision === "approve" ? "APROBAR" : "RECHAZAR";
    const note = decision === "approve"
      ? `¿${action} la cancelación de ${order.guestName}?\n\nEsto procesa un refund de ${formatMoney(order.totalAmount, order.currency)} a PayPal automáticamente.\n\nNota al huésped (opcional):`
      : `¿${action} la cancelación de ${order.guestName}?\n\nLa reserva sigue activa.\n\nMotivo del rechazo (visible al huésped):`;
    const reason = prompt(note, "");
    if (reason === null) return;

    setActing(order.id);
    try {
      const r = await fetch(`/api/service-orders/${order.id}/cancellation/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision, reason: reason.trim() || null }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        decision?: string;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        alert(j.error ?? "No se pudo procesar.");
        return;
      }
      alert(decision === "approve" ? "✓ Aprobada. Refund procesado en PayPal." : "Rechazada. Huésped fue notificado.");
      await load();
    } finally {
      setActing(null);
    }
  };

  // Refund real vía PayPal API. Pide confirmación con el monto en pantalla
  // y opcionalmente una nota que ve el huésped en su mail de PayPal.
  // Después del refund OK, recargamos para reflejar el nuevo estado.
  const refundOrder = async (order: Order) => {
    const totalLabel = formatMoney(order.totalAmount, order.currency);
    const confirmed = confirm(
      `¿Reembolsar ${totalLabel} al huésped ${order.guestName} vía PayPal?\n\n` +
        `Esta acción es definitiva: PayPal procesa el reembolso al instante.`,
    );
    if (!confirmed) return;
    const note = prompt(
      "Nota para el huésped (opcional, hasta 255 caracteres). Aparece en el email de PayPal:",
      "",
    );
    if (note === null) return; // canceló el prompt

    setActing(order.id);
    try {
      const res = await fetch(`/api/service-orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(note ? { note } : {}),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        warning?: string;
        alreadyRefunded?: boolean;
        refundPaymentId?: string;
      };
      if (!res.ok || !j.ok) {
        alert(j.error ?? "Error procesando el reembolso");
        return;
      }
      if (j.warning) {
        alert(j.warning);
      } else if (j.alreadyRefunded) {
        alert("Esta orden ya estaba reembolsada.");
      } else {
        alert(
          `Reembolso enviado a PayPal. ID: ${j.refundPaymentId}\n\n` +
            `Puede tardar unos minutos en reflejarse en el dashboard del huésped.`,
        );
      }
      await load();
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-6 mt-6">
      {/* Sprint 7.8 — banner para activar push del host. Solo se muestra si
          el browser soporta + no está ya suscripto + no rechazó. */}
      {hostPush.status === "available" && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-4 flex items-start gap-3">
          <Bell className="h-6 w-6 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-blue-900">Activá notificaciones de pedidos</p>
            <p className="text-xs text-blue-700 mt-1">
              Recibí un ping instantáneo si un vendor declina una orden o si llega un pedido nuevo — aunque tengas el dashboard cerrado.
            </p>
            <Button
              size="sm"
              className="mt-3 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => void hostPush.enable()}
              disabled={hostPush.status !== "available"}
            >
              <Bell className="h-3 w-3 mr-1.5" /> Activar notificaciones
            </Button>
          </div>
        </div>
      )}

      {hostPush.status === "subscribed" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 flex items-center gap-2 text-xs text-emerald-900">
          <Bell className="h-3.5 w-3.5" />
          <span className="font-semibold">Notificaciones activadas. Te avisamos al instante.</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pendientes</p>
            <p className="text-2xl font-bold mt-1">{stats.counts.pending ?? 0}</p>
            <p className="text-[10px] text-amber-600 mt-1">Esperando pago del huésped</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Por entregar</p>
            <p className="text-2xl font-bold mt-1">{stats.counts.paid ?? 0}</p>
            <p className="text-[10px] text-emerald-600 mt-1">Pagadas, coordinar con vendor</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Completadas</p>
            <p className="text-2xl font-bold mt-1">{stats.counts.completed ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Ingresos cobrados</p>
            <p className="text-xl font-bold mt-1 text-emerald-600">{formatMoney(stats.revenuePaid, "USD")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter pills + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "pending", "paid", "completed", "cancelled", "refunded"] as FilterStatus[]).map((f) => {
          const count = f === "all" ? orders.length : (stats.counts[f] ?? 0);
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 h-9 rounded-full text-xs font-bold border transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted/50 border-border"
              }`}
            >
              {f === "all" ? "Todas" : STATUS_META[f]?.label ?? f} ({count})
            </button>
          );
        })}
        <Button variant="ghost" size="sm" onClick={load} className="gap-2 ml-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refrescar
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <Card>
          <CardContent className="p-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando pedidos…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ShoppingCart className="h-10 w-10 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">
              {filter === "all"
                ? "Aún no recibiste pedidos."
                : `No hay pedidos en estado "${STATUS_META[filter]?.label ?? filter}".`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => {
            const meta = STATUS_META[o.status] ?? STATUS_META.pending;
            const isExpanded = expanded.has(o.id);
            const allowed = allowedTransitions(o.status);
            const isActing = acting === o.id;
            const whatsappLink = o.guestPhone
              ? `https://wa.me/${o.guestPhone.replace(/\D/g, "")}`
              : null;

            return (
              <Card key={o.id} className="overflow-hidden">
                <CardContent className="p-0">
                  {/* Header — siempre visible */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(o.id)}
                    className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge variant="outline" className={`text-[11px] ${meta.cls}`}>
                        {meta.emoji} {meta.label}
                      </Badge>
                      <p className="font-bold text-base flex-1 min-w-0 truncate">{o.guestName}</p>
                      <p className="text-lg font-extrabold whitespace-nowrap">{formatMoney(o.totalAmount, o.currency)}</p>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{o.items.length} item{o.items.length === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{new Date(o.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {o.paidAt && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-600">Pagado {new Date(o.paidAt).toLocaleString("es-ES", { day: "2-digit", month: "short" })}</span>
                        </>
                      )}
                    </div>
                  </button>

                  {/* Detalle expandido */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t bg-muted/10 space-y-4">
                      {/* Contacto del huésped */}
                      <div className="space-y-1 text-sm">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Contacto del huésped
                        </p>
                        <p>{o.guestName}</p>
                        {o.guestEmail && (
                          <a href={`mailto:${o.guestEmail}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {o.guestEmail}
                          </a>
                        )}
                        {o.guestPhone && whatsappLink && (
                          <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {o.guestPhone} (WhatsApp)
                          </a>
                        )}
                      </div>

                      {/* Items con vendor */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Servicios pedidos
                        </p>
                        {o.items.map((it) => {
                          const suffix = PRICING_SUFFIX[it.pricingModel] ?? "";
                          const qtyLabel = it.pricingModel === "fixed"
                            ? (it.quantity > 1 ? ` × ${it.quantity}` : "")
                            : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;

                          // Google Flights search link — gratis, sin API. Google
                          // detecta el formato del vuelo y lo trackea en vivo.
                          const flightLink = it.flightNumber
                            ? `https://www.google.com/search?q=vuelo+${encodeURIComponent(it.flightNumber)}`
                            : null;

                          // WhatsApp template al vendor: incluye hora, pickup,
                          // vuelo y notas. Antes solo iba la fecha — el vendor
                          // tenía que ir a buscar el resto en el panel.
                          const buildVendorMsg = () => {
                            const lines = [
                              `Hola ${it.vendor!.name}! Tenemos una reserva confirmada:`,
                              "",
                              `• ${it.name}${qtyLabel}`,
                            ];
                            if (it.serviceDate) lines.push(`📅 ${it.serviceDate}`);
                            if (it.serviceTime) lines.push(`🕒 ${it.serviceTime}`);
                            if (it.pickupLocation) lines.push(`📍 ${it.pickupLocation}`);
                            if (it.flightNumber) lines.push(`✈️ Vuelo ${it.flightNumber}`);
                            if (it.extraNotes) lines.push(`💬 ${it.extraNotes}`);
                            lines.push("");
                            lines.push(`👤 ${o.guestName}${o.guestPhone ? ` · ${o.guestPhone}` : ""}`);
                            lines.push("");
                            lines.push("¿Podés confirmar?");
                            return lines.join("\n");
                          };
                          const vendorWaText = it.vendor?.phone && o.status === "paid"
                            ? encodeURIComponent(buildVendorMsg())
                            : null;
                          const vendorWaLink = it.vendor?.phone && vendorWaText
                            ? `https://wa.me/${it.vendor.phone.replace(/\D/g, "")}?text=${vendorWaText}`
                            : null;

                          return (
                            <div key={it.id} className="p-3 bg-background rounded-lg border">
                              <div className="flex justify-between gap-2 items-start">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-sm">
                                    {it.name}<span className="font-normal text-slate-500">{qtyLabel}</span>
                                  </p>
                                  {it.serviceDate && (
                                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                                      <Calendar className="h-3 w-3" /> {it.serviceDate}
                                      {it.serviceTime && (
                                        <>
                                          <span className="text-slate-300">·</span>
                                          <Clock className="h-3 w-3" /> {it.serviceTime}
                                        </>
                                      )}
                                    </p>
                                  )}
                                  {!it.serviceDate && it.serviceTime && (
                                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                                      <Clock className="h-3 w-3" /> {it.serviceTime}
                                    </p>
                                  )}
                                  {it.pickupLocation && (
                                    <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1">
                                      <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                                      <span>{it.pickupLocation}</span>
                                    </p>
                                  )}
                                  {it.flightNumber && (
                                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                                      <Plane className="h-3 w-3" />
                                      <span className="font-mono font-semibold text-slate-700">
                                        {it.flightNumber}
                                      </span>
                                      {flightLink && (
                                        <a
                                          href={flightLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-amber-600 hover:underline ml-1 inline-flex items-center gap-0.5"
                                        >
                                          tracking
                                          <ExternalLink className="h-2.5 w-2.5" />
                                        </a>
                                      )}
                                    </p>
                                  )}
                                  {it.extraNotes && (
                                    <p className="text-[11px] text-slate-700 mt-1.5 p-2 bg-amber-50/60 border border-amber-100 rounded italic">
                                      💬 {it.extraNotes}
                                    </p>
                                  )}
                                  {it.vendor && (
                                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1.5">
                                      <Store className="h-3 w-3" /> {it.vendor.name}
                                      {it.vendor.phone && ` · ${it.vendor.phone}`}
                                    </p>
                                  )}
                                </div>
                                <p className="font-bold text-sm whitespace-nowrap">
                                  {formatMoney(it.lineTotal, o.currency)}
                                </p>
                              </div>
                              {vendorWaLink && (
                                <Button asChild size="sm" variant="outline" className="mt-2 h-7 text-xs">
                                  <a href={vendorWaLink} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-3 w-3 mr-1" /> Avisar al vendor
                                  </a>
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {o.notes && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1">
                            Nota del huésped
                          </p>
                          <p className="text-sm text-slate-700">{o.notes}</p>
                        </div>
                      )}

                      {o.paymentId && (
                        <div className="text-[11px] text-muted-foreground">
                          ID pago: <code className="font-mono">{o.paymentId}</code>
                        </div>
                      )}

                      {/* Sprint 8b — solicitud de cancelación del huésped con SLA visual.
                          El color escala según horas transcurridas:
                            <12h amber, 12-20h orange con borde grueso, >20h rojo parpadeante. */}
                      {o.cancellationRequestedAt && !o.cancellationDecidedAt && (() => {
                        const hoursSince = (Date.now() - new Date(o.cancellationRequestedAt).getTime()) / 3600000;
                        const urgencyClass = hoursSince > 20
                          ? "bg-rose-100 border-rose-400 text-rose-900 animate-pulse"
                          : hoursSince > 12
                          ? "bg-orange-50 border-orange-300 text-orange-900"
                          : "bg-amber-50 border-amber-200 text-amber-900";
                        const slaText = hoursSince > 20
                          ? `Quedan ~${Math.max(0, Math.round(24 - hoursSince))}h antes de auto-aprobación.`
                          : `${Math.round(hoursSince)}h transcurridas · 24h para decidir`;
                        return (
                          <div className={`p-3 border-2 rounded-lg space-y-2 ${urgencyClass}`}>
                            <p className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                              <AlertCircle className="h-3.5 w-3.5" />
                              Cancelación pedida por el huésped
                            </p>
                            {o.cancellationReason && (
                              <p className="text-xs italic">&ldquo;{o.cancellationReason}&rdquo;</p>
                            )}
                            <p className="text-[10px] font-semibold">{slaText}</p>
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                disabled={isActing}
                                onClick={() => decideCancellation(o, "approve")}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Aprobar + refund
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isActing}
                                onClick={() => decideCancellation(o, "reject")}
                                className="text-rose-700 border-rose-200 hover:bg-rose-50 text-xs"
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Rechazar
                              </Button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Sprint 7 — vendor decline banner + reasignar */}
                      {o.status === "paid" && o.vendorStatus === "declined" && (
                        <div className="p-3 bg-rose-50 border-2 border-rose-200 rounded-lg space-y-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-rose-800 flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5" />
                            El vendor declinó esta orden
                          </p>
                          {o.vendorDeclineReason && (
                            <p className="text-xs text-rose-700 italic">
                              &ldquo;{o.vendorDeclineReason}&rdquo;
                            </p>
                          )}
                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            <Select
                              disabled={isActing}
                              onValueChange={(vId) => reassignOrder(o, vId)}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1 min-w-[180px] bg-white">
                                <SelectValue placeholder="Reasignar a otro vendor…" />
                              </SelectTrigger>
                              <SelectContent>
                                {vendors
                                  .filter((v) => v.active)
                                  .map((v) => (
                                    <SelectItem key={v.id} value={v.id}>
                                      {v.displayName ?? v.name}
                                      <span className="text-muted-foreground text-[10px] ml-1">
                                        ({v.category})
                                      </span>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-[10px] text-rose-600">
                            Si ningún vendor puede atender, considerá reembolsar al huésped desde el botón de refund.
                          </p>
                        </div>
                      )}

                      {/* Banner positivo cuando vendor confirmó */}
                      {o.status === "paid" && o.vendorStatus === "confirmed" && (
                        <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" /> El vendor confirmó. Va a entregar el servicio.
                        </div>
                      )}

                      {/* Detalle del refund cuando aplicable */}
                      {o.status === "refunded" && o.refundedAt && (
                        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-purple-800">
                            ↩️ Reembolsado
                          </p>
                          <p className="text-sm text-slate-700">
                            {formatMoney(o.refundAmount ?? o.totalAmount, o.currency)}
                            <span className="text-[11px] text-purple-600 ml-2">
                              {new Date(o.refundedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                            </span>
                          </p>
                          {o.refundPaymentId && (
                            <p className="text-[11px] text-muted-foreground">
                              ID refund PayPal: <code className="font-mono">{o.refundPaymentId}</code>
                            </p>
                          )}
                          {o.refundNote && (
                            <p className="text-[11px] text-slate-600 italic">
                              Nota al huésped: &quot;{o.refundNote}&quot;
                            </p>
                          )}
                        </div>
                      )}

                      {/* Acciones */}
                      {(allowed.length > 0 || (o.status === "paid" && o.paymentProvider === "paypal")) && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t">
                          {allowed.includes("completed") && (
                            <Button
                              size="sm"
                              disabled={isActing}
                              onClick={() => updateStatus(o.id, "completed", "¿Marcar este pedido como completado?")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Marcar completado
                            </Button>
                          )}
                          {o.status === "paid" && o.paymentProvider === "paypal" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isActing}
                              onClick={() => refundOrder(o)}
                              className="text-purple-700 hover:bg-purple-50 border-purple-200"
                            >
                              <RefreshCw className="h-3 w-3 mr-1" /> Reembolsar vía PayPal
                            </Button>
                          )}
                          {allowed.includes("cancelled") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isActing}
                              onClick={() => updateStatus(o.id, "cancelled", "¿Cancelar esta orden pendiente?")}
                              className="text-rose-600 hover:bg-rose-50"
                            >
                              <XCircle className="h-3 w-3 mr-1" /> Cancelar
                            </Button>
                          )}
                          {isActing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
                      )}

                      {o.status === "pending" && (
                        <div className="text-[11px] text-amber-700 flex items-start gap-2 bg-amber-50/50 p-2 rounded">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            El huésped creó esta orden pero todavía no pagó. Se completa automáticamente cuando confirma el pago en PayPal.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
