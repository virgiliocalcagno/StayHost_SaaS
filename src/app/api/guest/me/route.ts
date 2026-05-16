/**
 * GET /api/guest/me
 *
 * Devuelve el historial de órdenes del huésped logueado, agrupado por host.
 *
 * Auth: sesión Supabase del huésped (no necesita tener tenant — al revés:
 * si el user tiene tenant, es host, redirigimos al dashboard).
 *
 * Side-effect: vincula órdenes pasadas con guest_email = user.email y
 * guest_auth_user_id = NULL. Esto pasa la primera vez que el huésped se
 * loguea con un email que coincide con compras anteriores como "guest"
 * (sin cuenta). Idempotente: si ya están vinculadas, no hace nada.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Si el user es owner de un tenant, no es huésped — flag para que el
  // cliente redirija al dashboard. (No bloqueamos: un mismo email puede
  // ser host de un tenant Y huésped en otro hub).
  const { data: ownedTenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isHost = !!ownedTenant;

  // Side-effect — linkeo retroactivo de órdenes pre-registro.
  // Solo lo intentamos si el user tiene email confirmado.
  if (user.email) {
    await supabaseAdmin
      .from("service_orders")
      .update({ guest_auth_user_id: user.id } as never)
      .ilike("guest_email", user.email)
      .is("guest_auth_user_id", null);
  }

  // Cargar todas las órdenes del user.
  const { data: orderRows } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, total_amount, currency, paid_at, created_at, guest_name, customer_token, redemption_token, redemption_pin, vendor_status, redeemed_at, vendor_decline_reason, vendor_action_token, refunded_at, refund_amount, cancellation_requested_at, cancellation_decided_at, cancellation_decision, cancellation_reason",
    )
    .eq("guest_auth_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = (orderRows ?? []) as Array<{
    id: string;
    tenant_id: string;
    status: string;
    total_amount: string | number;
    currency: string;
    paid_at: string | null;
    created_at: string;
    guest_name: string;
    customer_token: string;
    redemption_token: string | null;
    redemption_pin: string | null;
    vendor_status: string;
    redeemed_at: string | null;
    vendor_decline_reason: string | null;
    vendor_action_token: string | null;
    refunded_at: string | null;
    refund_amount: string | number | null;
    cancellation_requested_at: string | null;
    cancellation_decided_at: string | null;
    cancellation_decision: string | null;
    cancellation_reason: string | null;
  }>;

  // Tenants info pública (para mostrar nombre del host en cada card).
  const tenantIds = Array.from(new Set(orders.map((o) => o.tenant_id)));
  const tenantMap = new Map<string, { name: string; logo: string | null }>();
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabaseAdmin
      .from("tenants")
      .select("id, name, company, logo_url")
      .in("id", tenantIds);
    for (const t of ((tenants ?? []) as Array<{
      id: string; name: string | null; company: string | null; logo_url: string | null;
    }>)) {
      tenantMap.set(t.id, {
        name: t.company || t.name || "Host",
        logo: t.logo_url,
      });
    }
  }

  // Items en batch.
  const orderIds = orders.map((o) => o.id);
  const itemsByOrder = new Map<
    string,
    Array<{
      id: string;
      name: string;
      quantity: number;
      pricingModel: string;
      lineTotal: number;
      serviceDate: string | null;
      serviceTime: string | null;
    }>
  >();
  if (orderIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from("service_order_items")
      .select(
        "order_id, id, name, quantity, pricing_model, line_total, service_date, service_time",
      )
      .in("order_id", orderIds);
    for (const it of ((items ?? []) as Array<{
      order_id: string; id: string; name: string; quantity: number;
      pricing_model: string; line_total: string | number;
      service_date: string | null; service_time: string | null;
    }>)) {
      const arr = itemsByOrder.get(it.order_id) ?? [];
      arr.push({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        pricingModel: it.pricing_model,
        lineTotal: Number(it.line_total),
        serviceDate: it.service_date,
        serviceTime: it.service_time,
      });
      itemsByOrder.set(it.order_id, arr);
    }
  }

  const result = orders.map((o) => ({
    id: o.id,
    tenantId: o.tenant_id,
    host: tenantMap.get(o.tenant_id) ?? { name: "Host", logo: null },
    status: o.status,
    vendorStatus: o.vendor_status,
    total: Number(o.total_amount),
    currency: o.currency,
    paidAt: o.paid_at,
    createdAt: o.created_at,
    guestName: o.guest_name,
    redemptionToken: o.redemption_token,
    redemptionPin: o.redemption_pin,
    redeemedAt: o.redeemed_at,
    vendorDeclineReason: o.vendor_decline_reason,
    refundedAt: o.refunded_at,
    refundAmount: o.refund_amount != null ? Number(o.refund_amount) : null,
    cancellationRequestedAt: o.cancellation_requested_at,
    cancellationDecidedAt: o.cancellation_decided_at,
    cancellationDecision: o.cancellation_decision,
    cancellationReason: o.cancellation_reason,
    // URL del recibo (link al detalle público con customer_token).
    receiptUrl: `/hub/${o.tenant_id}/orden/${o.id}?t=${o.customer_token}`,
    items: itemsByOrder.get(o.id) ?? [],
  }));

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email ?? null,
      name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      avatar: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    },
    isHost,
    orders: result,
  });
}
