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
    .select(
      "id, tenant_id, status, total_amount, currency, paid_at, payment_id, guest_name, notes, created_at, redemption_token, redemption_pin, vendor_status, redeemed_at, vendor_action_token",
    )
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
    redemption_token: string | null;
    redemption_pin: string | null;
    vendor_status: string;
    redeemed_at: string | null;
    vendor_action_token: string | null;
  };

  // Items snapshot.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select("id, name, quantity, pricing_model, unit_price, line_total, service_date, vendor_id")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  // Sprint 7.5 — info pública de los vendors involucrados para que el
  // huésped pueda mandarles WhatsApp directo. Solo display_name + phone.
  // NUNCA exponemos comisión, email interno, notas, contrato, etc.
  const itemRows = (items ?? []) as Array<{
    id: string; name: string; quantity: number; pricing_model: string;
    unit_price: string | number; line_total: string | number;
    service_date: string | null;
    vendor_id: string | null;
  }>;
  const vendorIds = Array.from(
    new Set(itemRows.map((i) => i.vendor_id).filter((v): v is string => !!v)),
  );
  const vendorMap = new Map<string, { name: string; phone: string | null }>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabaseAdmin
      .from("upsell_vendors")
      .select("id, name, display_name, phone")
      .in("id", vendorIds)
      .eq("tenant_id", hostId);
    for (const v of ((vendors ?? []) as Array<{
      id: string; name: string; display_name: string | null; phone: string | null;
    }>)) {
      vendorMap.set(v.id, {
        name: v.display_name ?? v.name,
        phone: v.phone,
      });
    }
  }

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
      // Redención (Sprint 6) — exponemos token + PIN al cliente porque el
      // huésped es la cuenta legítima de este token. Quien intercepte el
      // customer_token ya tiene acceso completo de todas formas. El QR se
      // arma con la URL `/v/{redemption_token}` que abre el portal de
      // redención del vendor; el vendor sigue necesitando auth propia
      // para marcar entregada.
      redemptionToken: order.redemption_token,
      redemptionPin: order.redemption_pin,
      vendorStatus: order.vendor_status,
      redeemedAt: order.redeemed_at,
      // Sprint 7.5 — vendorActionToken para armar el wa.me directo al
      // vendor con link al portal. Solo sale al huésped legítimo (auth
      // por customer_token). El huésped puede iniciar el contacto pero
      // NO puede actuar acciones del vendor con este token (eso requiere
      // que se haga POST con el k correcto — el huésped lo tiene pero
      // los botones de acción no se le muestran).
      vendorActionToken: order.vendor_action_token,
      items: itemRows.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        pricingModel: i.pricing_model,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
        serviceDate: i.service_date,
        vendor: i.vendor_id ? vendorMap.get(i.vendor_id) ?? null : null,
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
