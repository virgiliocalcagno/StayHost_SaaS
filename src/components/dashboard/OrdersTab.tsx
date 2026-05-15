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
  Store,
  AlertCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";

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

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/service-orders", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const j = (await res.json()) as { orders: Order[] };
        setOrders(j.orders ?? []);
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

  // Transición allow-list — coincide con server-side. Sirve para decidir
  // qué botones mostrar.
  const allowedTransitions = (status: string): string[] => {
    if (status === "pending") return ["cancelled"];
    if (status === "paid") return ["completed", "refunded"];
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

  return (
    <div className="space-y-6 mt-6">
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

                          // WhatsApp template al vendor con todo lo necesario
                          // para que coordine: nombre del huésped, fecha,
                          // detalles del servicio. Cantidad + total + tel.
                          const vendorWaText = it.vendor?.phone && o.status === "paid"
                            ? encodeURIComponent(
                                `Hola ${it.vendor.name}! Tenemos una reserva confirmada:\n\n• ${it.name}${qtyLabel}${it.serviceDate ? `\n📅 ${it.serviceDate}` : ""}\n👤 ${o.guestName}${o.guestPhone ? ` · ${o.guestPhone}` : ""}\n\n¿Podés confirmar?`
                              )
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
                                    </p>
                                  )}
                                  {it.vendor && (
                                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
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

                      {/* Acciones */}
                      {allowed.length > 0 && (
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
                          {allowed.includes("refunded") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isActing}
                              onClick={() =>
                                updateStatus(
                                  o.id,
                                  "refunded",
                                  "Esto solo marca la orden como reembolsada. El refund real lo hacés vos en PayPal.\n\n¿Continuar?",
                                )
                              }
                            >
                              <RefreshCw className="h-3 w-3 mr-1" /> Marcar reembolsada
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
