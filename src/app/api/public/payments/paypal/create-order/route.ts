/**
 * POST /api/public/payments/paypal/create-order
 *
 * Endpoint PUBLICO (sin sesion) que el huesped llama desde la página
 * /hub/[hostId]/pay/[token] al apretar el botón de pago. Resuelve el
 * booking por payment_token, valida que esté aprobado y no pagado,
 * resuelve las credenciales PayPal del HOST (no las de StayHost) y
 * crea la orden contra la API de PayPal del host.
 *
 * Body: { paymentToken: string }
 * Response: { orderId, approveUrl }
 *
 * Seguridad:
 *   - El paymentToken es UUID v4, suficiente entropía contra fuerza
 *     bruta (122 bits).
 *   - El amount viene del booking en BD, NO del frontend — el huésped
 *     no puede manipularlo.
 *   - Si el host deshabilitó PayPal entre solicitud y pago, devolvemos
 *     503 con mensaje claro.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPaypalOrder } from "@/lib/paypal/client";

export async function POST(req: NextRequest) {
  let body: { paymentToken?: string };
  try {
    body = (await req.json()) as { paymentToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paymentToken = String(body.paymentToken ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(paymentToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  // Resolver booking por token. Aceptamos:
  //   - status='confirmed' (legacy: el host aprobó manual y el huésped paga después)
  //   - status='pending_review' + payment_method='paypal' (flow nuevo: el huésped
  //     paga ANTES de aprobación manual; capture auto-confirma)
  // En ambos casos NO debe estar paid_at todavía.
  const { data: bk } = await supabaseAdmin
    .from("bookings")
    .select("id, tenant_id, property_id, status, payment_method, total_price, paid_at, guest_name, guest_phone, check_in, check_out, channel_code")
    .eq("payment_token", paymentToken)
    .maybeSingle();

  if (!bk) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  const booking = bk as {
    id: string; tenant_id: string; property_id: string; status: string;
    payment_method: string | null;
    total_price: number | null; paid_at: string | null;
    guest_name: string | null; guest_phone: string | null;
    check_in: string; check_out: string; channel_code: string | null;
  };

  const acceptable =
    booking.status === "confirmed" ||
    (booking.status === "pending_review" && booking.payment_method === "paypal");
  if (!acceptable) {
    return NextResponse.json({ error: "Esta reserva no está disponible para pago" }, { status: 409 });
  }
  if (booking.paid_at) {
    return NextResponse.json({ error: "Esta reserva ya está pagada" }, { status: 409 });
  }
  if (!booking.total_price || booking.total_price <= 0) {
    return NextResponse.json({ error: "Reserva sin monto" }, { status: 400 });
  }

  // Credenciales del HOST.
  const { data: cfg } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode, enabled")
    .eq("tenant_id", booking.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfg as {
    id: string;
    client_id: string | null;
    client_secret: string | null;
    mode: string;
    enabled: boolean;
  } | null;

  if (!config || !config.enabled || !config.client_id || !config.client_secret) {
    return NextResponse.json(
      { error: "El host no tiene PayPal configurado" },
      { status: 503 }
    );
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  // Nombre de la propiedad para descripción de la orden.
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("name")
    .eq("id", booking.property_id)
    .maybeSingle<{ name: string }>();

  try {
    const order = await createPaypalOrder({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      amount: Number(booking.total_price),
      currency: "USD",
      description: `${prop?.name ?? "Estadía"} · ${booking.check_in} → ${booking.check_out}`,
      customId: booking.channel_code ?? booking.id,
    });

    return NextResponse.json({
      orderId: order.id,
      approveUrl: order.approveUrl,
      mode,
    });
  } catch (err) {
    console.error("[paypal/create-order]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error creando orden PayPal" },
      { status: 502 }
    );
  }
}
