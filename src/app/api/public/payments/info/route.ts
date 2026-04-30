/**
 * GET /api/public/payments/info?token=...
 *
 * Endpoint PUBLICO usado por la página /hub/[hostId]/pay/[token] para
 * mostrar el resumen de la reserva al huésped. Devuelve solo lo que el
 * huésped puede saber (ya hizo la solicitud y el host la aprobó):
 *   - propiedad, fechas, monto, divisa
 *   - status del pago (pending / paid)
 *   - PayPal client_id PUBLICO del host (NO el secret) para que el
 *     SDK de PayPal Smart Buttons cargue en el browser
 *   - mode (sandbox/live) para el SDK
 *
 * Token-based auth: el UUID del payment_token es suficiente entropía
 * (122 bits) para que sirva como secreto de acceso. Solo lo conoce el
 * huésped (lo recibió por WhatsApp del host) y el host.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const { data: bk } = await supabaseAdmin
    .from("bookings")
    .select("id, tenant_id, property_id, status, total_price, paid_at, check_in, check_out, guest_name, num_guests, channel_code")
    .eq("payment_token", token)
    .maybeSingle();
  if (!bk) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  const booking = bk as {
    id: string; tenant_id: string; property_id: string; status: string;
    total_price: number | null; paid_at: string | null;
    check_in: string; check_out: string;
    guest_name: string | null; num_guests: number | null;
    channel_code: string | null;
  };

  const [{ data: prop }, { data: tenant }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("properties").select("name, address, city").eq("id", booking.property_id).maybeSingle(),
    supabaseAdmin.from("tenants").select("id, company, name").eq("id", booking.tenant_id).maybeSingle(),
    supabaseAdmin
      .from("tenant_payment_configs")
      .select("client_id, mode, enabled")
      .eq("tenant_id", booking.tenant_id)
      .eq("provider", "paypal")
      .maybeSingle(),
  ]);

  const property = prop as { name: string; address: string | null; city: string | null } | null;
  const tenantRow = tenant as { id: string; company: string | null; name: string | null } | null;
  const config = cfg as { client_id: string | null; mode: string; enabled: boolean } | null;

  const paypalReady = !!(config?.enabled && config?.client_id);

  return NextResponse.json({
    booking: {
      id: booking.id,
      status: booking.status,
      paid: !!booking.paid_at,
      paidAt: booking.paid_at,
      total: booking.total_price ?? 0,
      currency: "USD",
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      guestName: booking.guest_name,
      numGuests: booking.num_guests,
      channelCode: booking.channel_code,
    },
    property: property
      ? {
          name: property.name,
          address: property.address,
          city: property.city,
        }
      : null,
    host: tenantRow
      ? {
          id: tenantRow.id,
          name: tenantRow.company || tenantRow.name || "Host",
        }
      : null,
    paypal: paypalReady
      ? {
          clientId: config!.client_id!,
          mode: (config!.mode === "live" ? "live" : "sandbox") as "sandbox" | "live",
        }
      : null,
  });
}
