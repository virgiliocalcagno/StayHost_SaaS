/**
 * POST /api/public/hub/[hostId]/service-order/[orderId]/paypal/create
 *
 * Crea la orden en PayPal usando las credenciales del host. Body requiere
 * `customerToken` (que el cliente recibió al crear la orden interna) para
 * que un atacante con el orderId solo no pueda armar pagos arbitrarios.
 *
 * Body: { customerToken: string }
 * Response: { orderId, approveUrl, mode }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPaypalOrder } from "@/lib/paypal/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; orderId: string }> },
) {
  const { hostId, orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(hostId) || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
  }

  let body: { customerToken?: string };
  try {
    body = (await req.json()) as { customerToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const customerToken = String(body.customerToken ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(customerToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select("id, tenant_id, status, total_amount, currency, paid_at, customer_token, guest_name")
    .eq("id", orderId)
    .eq("tenant_id", hostId)
    .eq("customer_token", customerToken)
    .maybeSingle();
  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const order = orderRow as {
    id: string; tenant_id: string; status: string;
    total_amount: number | string; currency: string;
    paid_at: string | null; customer_token: string;
    guest_name: string;
  };
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Esta orden ya no puede pagarse" }, { status: 409 });
  }
  if (order.paid_at) {
    return NextResponse.json({ error: "Orden ya pagada" }, { status: 409 });
  }

  const total = Number(order.total_amount);
  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: "Orden sin monto" }, { status: 400 });
  }

  // Credenciales PayPal del HOST (no de StayHost).
  const { data: cfg } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode, enabled")
    .eq("tenant_id", order.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfg as {
    id: string; client_id: string | null; client_secret: string | null;
    mode: string; enabled: boolean;
  } | null;
  if (!config || !config.enabled || !config.client_id || !config.client_secret) {
    return NextResponse.json(
      { error: "El host no tiene PayPal configurado" },
      { status: 503 },
    );
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  try {
    const paypalOrder = await createPaypalOrder({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      amount: total,
      currency: order.currency || "USD",
      description: `Servicios extras · ${order.guest_name}`,
      customId: order.id,
    });

    return NextResponse.json({
      orderId: paypalOrder.id,
      approveUrl: paypalOrder.approveUrl,
      mode,
    });
  } catch (err) {
    console.error("[service-order/paypal/create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error creando orden PayPal" },
      { status: 502 },
    );
  }
}
