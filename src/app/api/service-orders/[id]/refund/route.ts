/**
 * POST /api/service-orders/[id]/refund
 *
 * Refunda la orden vía PayPal API v2 (no solo cambia el estado).
 *
 * Pre-condiciones:
 *   - Caller autenticado + tenant linkado + role en MANAGE_ROLES.
 *   - Orden status='paid' + payment_provider='paypal'.
 *   - tenant_payment_configs PayPal habilitado y con credenciales.
 *
 * Flujo:
 *   1) Resolver capture_id (de payment_capture_id si existe; sino consultar
 *      PayPal con el order_id guardado en payment_id — fallback histórico).
 *   2) Llamar PayPal /v2/payments/captures/{id}/refund (full amount).
 *   3) Marcar service_orders: status='refunded', refunded_at, refund_amount,
 *      refund_payment_id, refund_note. UPDATE guard con refunded_at IS NULL
 *      para evitar doble refund por click concurrente.
 *
 * Idempotencia: si la orden ya tiene refund_payment_id, devolvemos OK con
 * alreadyRefunded=true. Si PayPal responde CAPTURE_FULLY_REFUNDED por algún
 * desfase, mapeamos a OK también (estado en PayPal manda).
 *
 * Body opcional: { note?: string }  — nota que ve el huésped en el refund.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refundPaypalCapture, getPaypalOrderCaptureId } from "@/lib/paypal/client";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Role guard. null member = owner directo. Si hay row exigimos rol válido.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null) {
    if (!member.role || !MANAGE_ROLES.has(member.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  let body: { note?: string } = {};
  try {
    body = (await req.json()) as { note?: string };
  } catch {
    /* body opcional — refund total sin nota */
  }
  const note = body.note ? String(body.note).trim().slice(0, 255) : undefined;

  // Leemos por RLS (la query usa la sesión del usuario) — defensa contra
  // un user intentando refundear orden de otro tenant.
  const { data: orderRow } = await supabase
    .from("service_orders")
    .select(
      "id, tenant_id, status, total_amount, currency, payment_provider, payment_id, payment_capture_id, paid_at, refunded_at, refund_payment_id, guest_email, guest_name",
    )
    .eq("id", id)
    .maybeSingle();

  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    total_amount: number | string;
    currency: string;
    payment_provider: string | null;
    payment_id: string | null;
    payment_capture_id: string | null;
    paid_at: string | null;
    refunded_at: string | null;
    refund_payment_id: string | null;
    guest_email: string | null;
    guest_name: string;
  };

  // Idempotencia: ya refundeada.
  if (order.refunded_at && order.refund_payment_id) {
    return NextResponse.json({
      ok: true,
      alreadyRefunded: true,
      refundPaymentId: order.refund_payment_id,
    });
  }

  // Validaciones de estado/método.
  if (order.payment_provider !== "paypal") {
    return NextResponse.json(
      {
        error:
          "Esta orden no fue pagada con PayPal. Para reembolsos manuales, contactá al huésped directamente.",
      },
      { status: 422 },
    );
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      {
        error: `Solo se pueden refundear órdenes pagadas (estado actual: ${order.status}).`,
      },
      { status: 422 },
    );
  }
  if (!order.payment_id) {
    return NextResponse.json(
      { error: "Falta payment_id en la orden — no se puede ubicar el pago." },
      { status: 422 },
    );
  }

  // Credenciales PayPal del host.
  const { data: cfgRow } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode, enabled")
    .eq("tenant_id", order.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfgRow as {
    id: string;
    client_id: string | null;
    client_secret: string | null;
    mode: string;
    enabled: boolean;
  } | null;
  if (!config || !config.client_id || !config.client_secret) {
    return NextResponse.json(
      {
        error:
          "PayPal del host no configurado o credenciales faltantes. Revisá Configuración → Pagos.",
      },
      { status: 503 },
    );
  }
  // Nota: NO exigimos config.enabled=true. Un host puede deshabilitar PayPal
  // (para parar nuevos cobros) pero seguir procesando refunds de órdenes
  // viejas — eso es UX correcto.
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  // Resolver capture_id. Si está en BD, usar directo. Si no (orden histórica
  // antes del fix), consultar PayPal con el order_id.
  let captureId = order.payment_capture_id;
  if (!captureId) {
    try {
      captureId = await getPaypalOrderCaptureId({
        configId: config.id,
        clientId: config.client_id,
        clientSecret: config.client_secret,
        mode,
        orderId: order.payment_id,
      });
    } catch (err) {
      console.error("[refund] getCaptureId failed:", err);
      return NextResponse.json(
        {
          error:
            "No se pudo ubicar el capture en PayPal. Verificá el pago en tu dashboard PayPal o reembolsá manualmente desde ahí.",
        },
        { status: 502 },
      );
    }
    if (!captureId) {
      return NextResponse.json(
        {
          error:
            "PayPal no devolvió capture para esta orden. Es posible que el pago no se haya capturado correctamente.",
        },
        { status: 422 },
      );
    }
  }

  // Disparar el refund. Full amount: pasamos amount+currency explícitos para
  // que PayPal valide contra el capture y rechace si hubo un mismatch.
  const totalAmount = Number(order.total_amount);
  let refund: { id: string; status: string; amount: number; currency: string };
  try {
    refund = await refundPaypalCapture({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      captureId,
      amount: totalAmount,
      currency: order.currency,
      noteToPayer: note,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[refund] PayPal refund failed:", msg);
    // CAPTURE_FULLY_REFUNDED: PayPal dice que ya está reembolsado, sincronizamos.
    if (msg.includes("CAPTURE_FULLY_REFUNDED")) {
      await supabaseAdmin
        .from("service_orders")
        .update({
          status: "refunded",
          refunded_at: new Date().toISOString(),
          refund_amount: totalAmount,
          refund_note: note ?? null,
        } as never)
        .eq("id", order.id)
        .is("refunded_at", null);
      return NextResponse.json({
        ok: true,
        alreadyRefunded: true,
        warning: "PayPal reporta este capture ya reembolsado. Sincronizamos el estado local.",
      });
    }
    // Otros errores: devolvemos el mensaje sanitizado al UI. El detalle queda en logs.
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // PayPal devuelve status COMPLETED en refunds aprobados al instante.
  // PENDING ocurre en métodos de pago alternativos (eCheck) — tratamos como
  // success igual y marcamos en BD; PayPal eventualmente lo settlea.
  const isAccepted = refund.status === "COMPLETED" || refund.status === "PENDING";
  if (!isAccepted) {
    return NextResponse.json(
      { error: `Refund no aceptado: ${refund.status}` },
      { status: 502 },
    );
  }

  // UPDATE con guard `refunded_at IS NULL` para concurrencia. Si otro request
  // ya marcó refund, no pisamos. Usamos supabaseAdmin acá porque el UPDATE
  // ya pasó toda la auth + validación de tenant arriba; la RLS de
  // service_orders no acepta UPDATE de status='paid' → 'refunded' (sólo del
  // capture endpoint).
  const { error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refund_amount: refund.amount || totalAmount,
      refund_payment_id: refund.id,
      refund_note: note ?? null,
    } as never)
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .is("refunded_at", null);

  if (upErr) {
    // El refund se procesó en PayPal pero falló el UPDATE en BD. Es crítico
    // — logueamos con todos los detalles y devolvemos warning para que el
    // host sepa que tiene que sincronizar manual.
    console.error(
      `[refund] CRITICAL: refund procesado en PayPal (refund_id=${refund.id}) pero UPDATE BD falló:`,
      upErr,
    );
    return NextResponse.json(
      {
        ok: true,
        warning:
          "El reembolso se procesó en PayPal pero no pudimos actualizar el estado en StayHost. Refund ID: " +
          refund.id +
          ". Contactá soporte.",
        refundPaymentId: refund.id,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    refundPaymentId: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
  });
}
