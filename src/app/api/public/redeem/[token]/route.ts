/**
 * GET /api/public/redeem/[token]
 *
 * Endpoint PÚBLICO sin auth. Devuelve datos de una orden a partir de su
 * redemption_token (el mismo que va en el QR del huésped y en el email
 * del vendor). Usado por el portal /v/[token] tanto desde el vendor (con
 * ?k=action_token para desbloquear acciones) como desde el huésped si
 * llegara a escanear su propio QR.
 *
 * Si viene ?k=<action_token>, validamos que coincida con
 * service_orders.vendor_action_token y devolvemos `canAct: true`. Sin
 * coincidencia, devolvemos `canAct: false` y la página renderiza modo
 * read-only.
 *
 * Privacy: el vendor SÍ necesita ver guest_name/guest_phone/guest_email
 * para coordinar. NO viola la regla de privacidad — el vendor es
 * contraparte comercial, no staff. Esto difere del email del host donde
 * el huésped tiene control: acá el vendor ya fue informado por email
 * fuera del portal.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Validación tolerante — redemption_token es 32 chars hex pero no
  // queremos rebotar si llega en upper/lowercase desde un escaneo manual.
  const normalized = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const actionToken = req.nextUrl.searchParams.get("k")?.trim() ?? null;

  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, total_amount, currency, paid_at, redeemed_at, vendor_status, vendor_action_token, vendor_decline_reason, vendor_confirmed_at, vendor_declined_at, guest_name, guest_phone, guest_email, redemption_pin",
    )
    .eq("redemption_token", normalized)
    .maybeSingle();

  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    total_amount: string | number;
    currency: string;
    paid_at: string | null;
    redeemed_at: string | null;
    vendor_status: string;
    vendor_action_token: string | null;
    vendor_decline_reason: string | null;
    vendor_confirmed_at: string | null;
    vendor_declined_at: string | null;
    guest_name: string;
    guest_phone: string | null;
    guest_email: string | null;
    redemption_pin: string | null;
  };

  // Las órdenes que aún no se pagaron NO se muestran al vendor — la URL del
  // portal solo se le manda al pasar a paid. Si llega a este endpoint con
  // una orden pending, devolvemos 404 para no leak info.
  if (order.status !== "paid" && order.status !== "completed" && order.status !== "refunded") {
    return NextResponse.json({ error: "Orden no disponible" }, { status: 404 });
  }

  // canAct: solo si vino action_token y matchea el de la orden.
  const canAct =
    !!actionToken &&
    !!order.vendor_action_token &&
    actionToken === order.vendor_action_token;

  // Items con info del servicio (hora, pickup, vuelo, notas). Vendor
  // necesita todo esto para entregar correctamente.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select(
      "id, name, quantity, pricing_model, unit_price, line_total, service_date, service_time, pickup_location, flight_number, extra_notes, vendor_id",
    )
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  // Host info pública.
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, company, contact_email, owner_whatsapp, logo_url")
    .eq("id", order.tenant_id)
    .maybeSingle();
  const tenantRow = tenant as {
    name: string | null; company: string | null;
    contact_email: string | null; owner_whatsapp: string | null;
    logo_url: string | null;
  } | null;

  // Vendors mencionados en los items — para mostrar al vendor "vos sos X".
  const vendorIds = Array.from(
    new Set(
      ((items ?? []) as Array<{ vendor_id: string | null }>)
        .map((i) => i.vendor_id)
        .filter((v): v is string => !!v),
    ),
  );
  const vendorMap = new Map<string, { name: string; phone: string | null }>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabaseAdmin
      .from("upsell_vendors")
      .select("id, name, display_name, phone")
      .in("id", vendorIds)
      .eq("tenant_id", order.tenant_id);
    for (const v of ((vendors ?? []) as Array<{
      id: string; name: string; display_name: string | null; phone: string | null;
    }>)) {
      vendorMap.set(v.id, { name: v.display_name ?? v.name, phone: v.phone });
    }
  }

  return NextResponse.json({
    canAct,
    order: {
      id: order.id,
      status: order.status,
      vendorStatus: order.vendor_status,
      paidAt: order.paid_at,
      redeemedAt: order.redeemed_at,
      vendorConfirmedAt: order.vendor_confirmed_at,
      vendorDeclinedAt: order.vendor_declined_at,
      vendorDeclineReason: order.vendor_decline_reason,
      total: Number(order.total_amount),
      currency: order.currency,
      guestName: order.guest_name,
      // PII del huésped expuesta acá — el portal del vendor lo necesita
      // para coordinar. Quien tiene el token tiene acceso autorizado.
      guestPhone: order.guest_phone,
      guestEmail: order.guest_email,
      items: ((items ?? []) as Array<{
        id: string; name: string; quantity: number; pricing_model: string;
        unit_price: string | number; line_total: string | number;
        service_date: string | null;
        service_time: string | null;
        pickup_location: string | null;
        flight_number: string | null;
        extra_notes: string | null;
        vendor_id: string | null;
      }>).map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        pricingModel: i.pricing_model,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
        serviceDate: i.service_date,
        serviceTime: i.service_time,
        pickupLocation: i.pickup_location,
        flightNumber: i.flight_number,
        extraNotes: i.extra_notes,
        vendor: i.vendor_id ? vendorMap.get(i.vendor_id) ?? null : null,
      })),
    },
    host: {
      name: tenantRow?.company || tenantRow?.name || "Host",
      whatsapp: tenantRow?.owner_whatsapp ?? null,
      email: tenantRow?.contact_email ?? null,
      logo: tenantRow?.logo_url ?? null,
    },
  });
}
