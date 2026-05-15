/**
 * GET /api/public/hub/[hostId]/service-order/[orderId]?token=...
 *
 * Devuelve info pública de la orden para que la página de pago la
 * muestre + arme el SDK de PayPal con el client_id del host.
 *
 * Requiere customer_token en query — sin él, 404 (no leak de existencia).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; orderId: string }> },
) {
  const { hostId, orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(hostId) || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  // Solo pedimos lo necesario al renderizar la página de pago. NO incluimos
  // guest_email ni guest_phone — el customer_token puede quedar en logs de
  // Vercel (URL query) y quien lo intercepte no debe poder recuperar PII
  // del huésped a través de este GET. El huésped ya conoce sus propios datos.
  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select("id, tenant_id, status, total_amount, currency, paid_at, payment_id, guest_name, notes, created_at")
    .eq("id", orderId)
    .eq("tenant_id", hostId)
    .eq("customer_token", token)
    .maybeSingle();
  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const order = orderRow as {
    id: string; tenant_id: string; status: string;
    total_amount: string | number; currency: string;
    paid_at: string | null; payment_id: string | null;
    guest_name: string;
    notes: string | null; created_at: string;
  };

  // Items snapshot.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select("id, name, quantity, pricing_model, unit_price, line_total, service_date")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  // Tenant info pública (no exponemos email de cuenta).
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, company, owner_whatsapp, contact_email, logo_url")
    .eq("id", hostId)
    .maybeSingle();
  const tenantRow = tenant as {
    name: string | null; company: string | null;
    owner_whatsapp: string | null; contact_email: string | null;
    logo_url: string | null;
  } | null;

  // PayPal config — exponemos solo client_id (público) + mode.
  const { data: cfg } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("client_id, mode, enabled")
    .eq("tenant_id", hostId)
    .eq("provider", "paypal")
    .maybeSingle();
  const ppRow = cfg as { client_id: string | null; mode: string; enabled: boolean } | null;
  const paypalAvailable = !!ppRow && !!ppRow.enabled && !!ppRow.client_id;

  return NextResponse.json({
    order: {
      id: order.id,
      status: order.status,
      total: Number(order.total_amount),
      currency: order.currency,
      paidAt: order.paid_at,
      paymentId: order.payment_id,
      guestName: order.guest_name,
      // guestEmail/guestPhone removidos del response público — ver query.
      notes: order.notes,
      createdAt: order.created_at,
      items: ((items ?? []) as Array<{
        id: string; name: string; quantity: number; pricing_model: string;
        unit_price: string | number; line_total: string | number;
        service_date: string | null;
      }>).map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        pricingModel: i.pricing_model,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
        serviceDate: i.service_date,
      })),
    },
    host: {
      name: tenantRow?.company || tenantRow?.name || "Reservas Directas",
      contactEmail: tenantRow?.contact_email ?? null,
      whatsapp: tenantRow?.owner_whatsapp ?? null,
      logo: tenantRow?.logo_url ?? null,
    },
    paypal: paypalAvailable
      ? { clientId: ppRow!.client_id!, mode: ppRow!.mode === "live" ? "live" : "sandbox" }
      : null,
  });
}
