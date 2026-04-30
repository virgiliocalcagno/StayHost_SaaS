/**
 * POST /api/public/payments/paypal/capture
 *
 * El huésped completó la aprobación en PayPal (popup o redirect) y vuelve
 * con el orderId. Capturamos contra las credenciales del host y, si OK,
 * marcamos el booking como paid_at + payment_id.
 *
 * Body: { paymentToken: string, orderId: string }
 *
 * Idempotencia:
 *   - Si el booking ya está paid_at, devolvemos 200 con ok=true sin
 *     re-capturar (PayPal rechazaría el segundo intento).
 *   - Si la captura falla, NO marcamos como pagado y devolvemos error.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { capturePaypalOrder } from "@/lib/paypal/client";

export async function POST(req: NextRequest) {
  let body: { paymentToken?: string; orderId?: string };
  try {
    body = (await req.json()) as { paymentToken?: string; orderId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paymentToken = String(body.paymentToken ?? "").trim();
  const orderId = String(body.orderId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(paymentToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }
  if (!orderId) {
    return NextResponse.json({ error: "orderId requerido" }, { status: 400 });
  }

  const { data: bk } = await supabaseAdmin
    .from("bookings")
    .select("id, tenant_id, status, paid_at")
    .eq("payment_token", paymentToken)
    .maybeSingle();
  if (!bk) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  const booking = bk as { id: string; tenant_id: string; status: string; paid_at: string | null };

  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "Reserva no aprobada" }, { status: 409 });
  }
  if (booking.paid_at) {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  const { data: cfg } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode, enabled")
    .eq("tenant_id", booking.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfg as {
    id: string; client_id: string | null; client_secret: string | null; mode: string; enabled: boolean;
  } | null;
  if (!config || !config.client_id || !config.client_secret) {
    return NextResponse.json({ error: "Configuración PayPal no encontrada" }, { status: 503 });
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  try {
    const result = await capturePaypalOrder({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      orderId,
    });

    if (result.status !== "COMPLETED") {
      return NextResponse.json(
        { error: `Captura no completada: ${result.status}` },
        { status: 502 }
      );
    }

    // Marcar booking como pagado. Update con guard de paid_at IS NULL para
    // evitar que dos requests concurrentes ambos marquen pagado.
    const { error: upErr } = await supabaseAdmin
      .from("bookings")
      .update({
        paid_at: new Date().toISOString(),
        payment_provider: "paypal",
        payment_id: result.id,
      } as never)
      .eq("id", booking.id)
      .is("paid_at", null);

    if (upErr) {
      console.error("[paypal/capture] update booking failed:", upErr);
      // El pago se capturó pero no pudimos marcarlo. El host lo va a ver
      // en el dashboard de PayPal igual; debería marcarlo a mano.
    }

    return NextResponse.json({
      ok: true,
      paymentId: result.id,
      payerEmail: result.payerEmail,
    });
  } catch (err) {
    console.error("[paypal/capture]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error capturando pago" },
      { status: 502 }
    );
  }
}
