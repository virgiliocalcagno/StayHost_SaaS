/**
 * /api/service-orders — gestión de órdenes de Ventas Extras desde el panel
 * del host (auth).
 *
 * GET: lista de órdenes del tenant con sus items + vendor info enriquecida.
 *      Query opcional: ?status=pending|paid|completed|cancelled|refunded
 *
 * RLS sobre `service_orders` ya filtra por tenant_id. El filtro explícito
 * en la query es defensa en profundidad.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// Solo el owner y roles administrativos ven service_orders. Cleaner/
// maintenance NO debe acceder — el response incluye PII del huésped
// (email, phone) y datos comerciales del vendor (comisión, costos).
// Coincide con `feedback_privacidad_huesped.md`.
const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

const VALID_STATUSES = new Set([
  "pending",
  "paid",
  "completed",
  "cancelled",
  "refunded",
]);

type OrderRow = {
  id: string;
  tenant_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  status: string;
  total_amount: string | number;
  currency: string;
  payment_provider: string | null;
  payment_id: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Refund (Sprint 4 polish): se completan al disparar POST /refund.
  refunded_at: string | null;
  refund_amount: string | number | null;
  refund_payment_id: string | null;
  refund_note: string | null;
  // Sprint 7 — estado del vendor
  vendor_status: string | null;
  vendor_declined_at: string | null;
  vendor_decline_reason: string | null;
  // Sprint 8b — cancelación
  cancellation_requested_at: string | null;
  cancellation_requested_by: string | null;
  cancellation_reason: string | null;
  cancellation_decided_at: string | null;
  cancellation_decision: string | null;
};

type ItemRow = {
  id: string;
  order_id: string;
  upsell_id: string | null;
  vendor_id: string | null;
  name: string;
  pricing_model: string;
  unit_price: string | number;
  quantity: number;
  service_date: string | null;
  line_total: string | number;
  // Sprint 5: info del servicio capturada al checkout
  service_time: string | null;
  pickup_location: string | null;
  flight_number: string | null;
  extra_notes: string | null;
};


export async function GET(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Role guard: solo owner/admin/manager/co_host. Cleaner/maintenance NO
  // — el response tiene PII del huésped + datos comerciales del vendor.
  // Si no hay row en team_members, asumimos owner directo (consistente
  // con el patrón de /api/upsells).
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  // null = owner directo, OK. Si hay member, exige rol en allow-list
  // (incluyendo role=null que tratamos como "no autorizado" explícito —
  // mejor falso negativo que permitir bypass por dato sucio).
  if (member !== null) {
    if (!member.role || !MANAGE_ROLES.has(member.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const statusFilter = req.nextUrl.searchParams.get("status");
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  let q = supabase
    .from("service_orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (statusFilter) q = q.eq("status", statusFilter);

  const { data: orders, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orderRows = (orders ?? []) as OrderRow[];
  const orderIds = orderRows.map((o) => o.id);

  // Items en batch. RLS de service_order_items filtra via service_orders.
  let items: ItemRow[] = [];
  if (orderIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("service_order_items")
      .select("*")
      .in("order_id", orderIds);
    items = (itemRows ?? []) as ItemRow[];
  }

  // Vendor lookup en batch. Cargamos display_name + phone para que el
  // host pueda mandarle WhatsApp directo desde el panel. RLS filtra por
  // tenant automaticamente.
  const vendorIds = Array.from(
    new Set(items.map((i) => i.vendor_id).filter((v): v is string => !!v)),
  );
  const vendorMap = new Map<
    string,
    { name: string; phone: string | null; defaultPricingMethod: string; commissionPercent: number; defaultFixedCost: number | null; defaultFlatFee: number | null }
  >();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabase
      .from("upsell_vendors")
      .select("id, name, display_name, phone, default_pricing_method, commission_percent, default_fixed_cost, default_flat_fee")
      .in("id", vendorIds);
    for (const v of (vendors ?? []) as Array<{
      id: string;
      name: string;
      display_name: string | null;
      phone: string | null;
      default_pricing_method: string;
      commission_percent: string | number;
      default_fixed_cost: string | number | null;
      default_flat_fee: string | number | null;
    }>) {
      vendorMap.set(v.id, {
        name: v.display_name ?? v.name,
        phone: v.phone,
        defaultPricingMethod: v.default_pricing_method,
        commissionPercent: Number(v.commission_percent),
        defaultFixedCost: v.default_fixed_cost != null ? Number(v.default_fixed_cost) : null,
        defaultFlatFee: v.default_flat_fee != null ? Number(v.default_flat_fee) : null,
      });
    }
  }

  // Armar el response: cada orden con su array de items + vendor enriched.
  const result = orderRows.map((o) => {
    const orderItems = items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        id: i.id,
        upsellId: i.upsell_id,
        vendorId: i.vendor_id,
        vendor: i.vendor_id ? vendorMap.get(i.vendor_id) ?? null : null,
        name: i.name,
        pricingModel: i.pricing_model,
        unitPrice: Number(i.unit_price),
        quantity: i.quantity,
        serviceDate: i.service_date,
        lineTotal: Number(i.line_total),
        serviceTime: i.service_time,
        pickupLocation: i.pickup_location,
        flightNumber: i.flight_number,
        extraNotes: i.extra_notes,
      }));
    return {
      id: o.id,
      guestName: o.guest_name,
      guestEmail: o.guest_email,
      guestPhone: o.guest_phone,
      status: o.status,
      totalAmount: Number(o.total_amount),
      currency: o.currency,
      paymentProvider: o.payment_provider,
      paymentId: o.payment_id,
      paidAt: o.paid_at,
      notes: o.notes,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      refundedAt: o.refunded_at,
      refundAmount: o.refund_amount != null ? Number(o.refund_amount) : null,
      refundPaymentId: o.refund_payment_id,
      refundNote: o.refund_note,
      vendorStatus: o.vendor_status,
      vendorDeclinedAt: o.vendor_declined_at,
      vendorDeclineReason: o.vendor_decline_reason,
      cancellationRequestedAt: o.cancellation_requested_at,
      cancellationRequestedBy: o.cancellation_requested_by,
      cancellationReason: o.cancellation_reason,
      cancellationDecidedAt: o.cancellation_decided_at,
      cancellationDecision: o.cancellation_decision,
      items: orderItems,
    };
  });

  return NextResponse.json({ orders: result });
}
