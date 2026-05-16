"use client";

/**
 * /cuenta — Mi historial del huésped.
 *
 * Transversal a TODOS los hosts donde el huésped haya comprado. Si llega
 * sin sesión, mostramos el AuthModal. Si está logueado, mostramos su
 * historial agrupado por host con estado de cada orden.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ShoppingBag,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  LogOut,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import GuestAuthModal from "@/components/auth/GuestAuthModal";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  pricingModel: string;
  lineTotal: number;
  serviceDate: string | null;
  serviceTime: string | null;
}

interface Order {
  id: string;
  tenantId: string;
  host: { name: string; logo: string | null };
  status: string;
  vendorStatus: string;
  total: number;
  currency: string;
  paidAt: string | null;
  createdAt: string;
  guestName: string;
  redemptionPin: string | null;
  redeemedAt: string | null;
  refundedAt: string | null;
  refundAmount: number | null;
  cancellationRequestedAt: string | null;
  cancellationDecidedAt: string | null;
  cancellationDecision: string | null;
  cancellationReason: string | null;
  receiptUrl: string;
  items: OrderItem[];
}

interface GuestMe {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    avatar: string | null;
  };
  isHost: boolean;
  orders: Order[];
}

const VENDOR_BADGE: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  awaiting: { label: "Aguardando confirmación", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
  confirmed: { label: "Confirmada", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: CheckCircle2 },
  declined: { label: "Vendor declinó", cls: "bg-rose-100 text-rose-800 border-rose-200", icon: XCircle },
  delivered: { label: "Entregada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  no_show: { label: "No show", cls: "bg-slate-100 text-slate-700 border-slate-200", icon: AlertCircle },
};

export default function GuestAccountPage() {
  const [me, setMe] = useState<GuestMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/guest/me", { cache: "no-store", credentials: "include" });
      if (r.status === 401) {
        setMe(null);
        setAuthOpen(true);
        return;
      }
      if (r.ok) {
        const j = (await r.json()) as GuestMe;
        setMe(j);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setMe(null);
    setAuthOpen(true);
  };

  const handleCancel = async (orderId: string) => {
    const reason = prompt(
      "¿Querés cancelar este pedido?\n\nMotivo (opcional, lo ve el host):",
      "",
    );
    if (reason === null) return; // canceló el prompt
    try {
      const r = await fetch(`/api/guest/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        mode?: "auto-cancelled" | "request-pending";
        message?: string;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        alert(j.error ?? "No se pudo cancelar.");
        return;
      }
      alert(j.message ?? "Solicitud enviada.");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error de red");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <ShoppingBag className="h-16 w-16 mx-auto mb-4 text-slate-300" />
          <h1 className="text-2xl font-bold mb-2">Mi cuenta</h1>
          <p className="text-slate-600 mb-6">Iniciá sesión para ver tu historial de pedidos.</p>
          <Button onClick={() => setAuthOpen(true)} className="gradient-gold text-white" size="lg">
            Iniciá sesión
          </Button>
        </div>
        <GuestAuthModal
          open={authOpen}
          onOpenChange={(open) => {
            setAuthOpen(open);
            if (!open) void load();
          }}
        />
      </main>
    );
  }

  // Agrupar órdenes por host para mostrar visualmente.
  const byHost = new Map<string, { host: Order["host"]; orders: Order[] }>();
  for (const o of me.orders) {
    const k = o.tenantId;
    const g = byHost.get(k);
    if (g) g.orders.push(o);
    else byHost.set(k, { host: o.host, orders: [o] });
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg">Mi cuenta</h1>
            <p className="text-xs text-slate-500 truncate">
              {me.user.name ?? me.user.email}
            </p>
          </div>
          {me.user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.user.avatar}
              alt=""
              className="w-9 h-9 rounded-full object-cover border-2 border-white shadow"
            />
          ) : null}
          <Button variant="ghost" size="sm" onClick={handleLogout} title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 pt-6 space-y-6">
        {me.isHost && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              También sos host de un tenant.{" "}
              <Link href="/dashboard" className="underline font-semibold">
                Ir al dashboard
              </Link>
              .
            </p>
          </div>
        )}

        {me.orders.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <p className="font-bold text-lg">Sin pedidos todavía</p>
            <p className="text-slate-500 text-sm">Cuando compres algo en un hub de StayHost, lo vas a ver acá.</p>
          </div>
        ) : (
          Array.from(byHost.entries()).map(([tenantId, group]) => (
            <section key={tenantId} className="space-y-3">
              <div className="flex items-center gap-3">
                {group.host.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.host.logo}
                    alt={group.host.name}
                    className="w-10 h-10 rounded-full object-cover border-2 border-white shadow"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-lg">
                    🏠
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{group.host.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {group.orders.length} {group.orders.length === 1 ? "pedido" : "pedidos"}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="text-xs">
                  <a href={`/hub/${tenantId}/extras`} target="_blank" rel="noopener noreferrer">
                    Ver tienda <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>

              <div className="space-y-2">
                {group.orders.map((o) => {
                  const isRefunded = !!o.refundedAt;
                  const isCancelPending =
                    !!o.cancellationRequestedAt && !o.cancellationDecidedAt;
                  const wasRejected = o.cancellationDecision === "rejected";
                  const canCancel =
                    !isRefunded &&
                    !isCancelPending &&
                    o.status === "paid" &&
                    o.vendorStatus !== "delivered";
                  const badge = isRefunded
                    ? { label: "Reembolsada", cls: "bg-purple-100 text-purple-800 border-purple-200", icon: AlertCircle }
                    : isCancelPending
                    ? { label: "Cancelación pendiente", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock }
                    : VENDOR_BADGE[o.vendorStatus] ?? VENDOR_BADGE.awaiting;
                  const Icon = badge.icon;
                  return (
                    <div
                      key={o.id}
                      className="block bg-white rounded-2xl border shadow-sm p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <Badge className={`text-[10px] ${badge.cls}`}>
                          <Icon className="h-3 w-3 mr-1" /> {badge.label}
                        </Badge>
                        <p className="font-extrabold text-lg shrink-0">
                          {formatMoney(o.total, o.currency)}
                        </p>
                      </div>
                      <div className="space-y-1 mb-3">
                        {o.items.slice(0, 3).map((it) => (
                          <p key={it.id} className="text-sm flex justify-between gap-2">
                            <span className="truncate">
                              {it.name}
                              {it.quantity > 1 && (
                                <span className="text-slate-400 ml-1">× {it.quantity}</span>
                              )}
                            </span>
                            {(it.serviceDate || it.serviceTime) && (
                              <span className="text-[11px] text-slate-500 flex items-center gap-1 shrink-0">
                                <Calendar className="h-3 w-3" />
                                {it.serviceDate}
                                {it.serviceTime && ` · ${it.serviceTime}`}
                              </span>
                            )}
                          </p>
                        ))}
                        {o.items.length > 3 && (
                          <p className="text-[11px] text-slate-500">
                            +{o.items.length - 3} más…
                          </p>
                        )}
                      </div>

                      {/* Sprint 8b — banner de estado de cancelación */}
                      {isCancelPending && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-900">
                          <p className="font-semibold">Solicitud de cancelación en revisión</p>
                          <p className="text-[11px] mt-0.5">
                            El host tiene 24h para decidir. Te avisamos por email.
                            {o.cancellationReason && (
                              <span className="italic block mt-1">
                                Motivo: &ldquo;{o.cancellationReason}&rdquo;
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      {wasRejected && (
                        <div className="bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3 text-xs text-rose-900">
                          <p className="font-semibold">Cancelación rechazada</p>
                          <p className="text-[11px] mt-0.5">La reserva sigue activa.</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-2 border-t flex-wrap">
                        <span>
                          {o.paidAt
                            ? `Pagada ${new Date(o.paidAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}`
                            : `Creada ${new Date(o.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}`}
                        </span>
                        {o.redemptionPin && !o.redeemedAt && !isRefunded && !isCancelPending && (
                          <span className="font-mono font-bold text-slate-700">
                            PIN: {o.redemptionPin}
                          </span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          <a
                            href={o.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-600 font-semibold hover:underline"
                          >
                            Ver detalle →
                          </a>
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => handleCancel(o.id)}
                              className="text-rose-600 font-semibold hover:underline text-[11px]"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
