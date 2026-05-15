/**
 * POST /api/public/hub/[hostId]/service-order/[orderId]/paypal/capture
 *
 * El huésped completó la aprobación PayPal y vuelve con el orderId de
 * PayPal. Capturamos contra las credenciales del host. Si captura OK:
 *   - Marcamos service_orders.paid_at + payment_id
 *   - Enviamos email al host con resumen (best-effort)
 *
 * Body: { customerToken: string, paypalOrderId: string }
 *
 * Idempotencia: si la orden ya está pagada, devolvemos ok=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { capturePaypalOrder } from "@/lib/paypal/client";
import { sendEmail } from "@/lib/email/send";
import { renderServiceOrderPaidHostEmail } from "@/lib/email/templates/service-order-paid-host";
import { renderServiceOrderPaidGuestEmail } from "@/lib/email/templates/service-order-paid-guest";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; orderId: string }> },
) {
  const { hostId, orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(hostId) || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
  }

  let body: { customerToken?: string; paypalOrderId?: string };
  try {
    body = (await req.json()) as { customerToken?: string; paypalOrderId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const customerToken = String(body.customerToken ?? "").trim();
  const paypalOrderId = String(body.paypalOrderId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(customerToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }
  // PayPal order IDs son alfanuméricos de ~17 chars. Filtramos basura
  // antes de pegar contra la API de PayPal.
  if (!/^[A-Z0-9]{10,30}$/i.test(paypalOrderId)) {
    return NextResponse.json({ error: "paypalOrderId inválido" }, { status: 400 });
  }

  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select("id, tenant_id, status, total_amount, currency, paid_at, customer_token, guest_name, guest_email, guest_phone, notes")
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
    guest_name: string; guest_email: string | null; guest_phone: string | null;
    notes: string | null;
  };

  // Idempotente: si ya estaba pagada, devolvemos OK sin re-capturar.
  if (order.paid_at) {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Orden no disponible para pago" }, { status: 409 });
  }

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
  // ROJO: si el host deshabilitó PayPal entre create y capture, NO seguir.
  // Antes el guard solo chequeaba client_id/secret presentes — un host que
  // pausa PayPal igual podía cobrar porque las credenciales viejas seguían
  // ahí. Ahora exigimos enabled=true también.
  if (!config || !config.enabled || !config.client_id || !config.client_secret) {
    return NextResponse.json({ error: "PayPal del host no disponible" }, { status: 503 });
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  let captureResult: {
    id: string;
    status: string;
    payerEmail: string | null;
    amount: number;
    currency: string;
  };
  try {
    captureResult = await capturePaypalOrder({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      orderId: paypalOrderId,
    });
  } catch (err) {
    console.error("[service-order/paypal/capture]", err);
    // No exponemos el mensaje crudo de PayPal — puede tener detalles
    // internos de configuración. El detalle queda en logs del servidor.
    return NextResponse.json(
      { error: "Error capturando pago" },
      { status: 502 },
    );
  }

  if (captureResult.status !== "COMPLETED") {
    return NextResponse.json(
      { error: `Captura no completada: ${captureResult.status}` },
      { status: 502 },
    );
  }

  // ROJO: validar que el monto capturado por PayPal coincida con lo que
  // tenemos en BD. Si por alguna razón difieren (parcial, dispute, bug
  // del provider), NO marcamos como paid — el host investiga manual en
  // el dashboard de PayPal.
  const expectedAmount = Number(order.total_amount);
  if (Math.abs(captureResult.amount - expectedAmount) > 0.01) {
    console.error(
      `[service-order/paypal/capture] amount mismatch: paypal=${captureResult.amount} expected=${expectedAmount} order=${order.id}`,
    );
    return NextResponse.json(
      { error: "Monto capturado no coincide. Contactá al host." },
      { status: 502 },
    );
  }

  // ROJO: update con guard de paid_at IS NULL para concurrencia, pero
  // usando .select() para saber si esta llamada FUE la que capturó o si
  // perdió la carrera con otro request concurrente. Sin esto el segundo
  // request entraba al bloque de email y mandaba notificación duplicada.
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_provider: "paypal",
      payment_id: captureResult.id,
    } as never)
    .eq("id", order.id)
    .is("paid_at", null)
    .select("id");

  const updatedThisRequest = !upErr && Array.isArray(updated) && updated.length > 0;
  if (upErr) {
    console.error("[service-order/paypal/capture] update failed:", upErr);
  }

  // Emails post-pago — best-effort. SOLO si esta llamada fue la que
  // escribió paid_at (evita emails duplicados en concurrencia).
  // Mandamos 2 emails: al host (notificación operativa) y al huésped
  // (confirmación + datos contacto del host).
  if (updatedThisRequest) {
    try {
      const [{ data: items }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from("service_order_items")
          .select("name, quantity, pricing_model, unit_price, line_total, service_date")
          .eq("order_id", order.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("tenants")
          .select("name, company, contact_email, owner_whatsapp, email")
          .eq("id", order.tenant_id)
          .maybeSingle(),
      ]);

      const tenantRow = tenant as {
        name: string | null; company: string | null;
        contact_email: string | null; owner_whatsapp: string | null; email: string;
      } | null;
      const hostName = tenantRow?.company || tenantRow?.name || "Tu host";
      // Email del host: preferimos contact_email pero si no, caemos al email
      // de cuenta. Notificación interna — no se expone al huésped.
      const hostEmail = tenantRow?.contact_email ?? tenantRow?.email ?? null;
      const hostWhatsapp = tenantRow?.owner_whatsapp ?? null;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

      const itemsMapped = ((items ?? []) as Array<{
        name: string; quantity: number; pricing_model: string;
        unit_price: string | number; line_total: string | number;
        service_date: string | null;
      }>).map((it) => ({
        name: it.name,
        quantity: it.quantity,
        pricingModel: it.pricing_model,
        unitPrice: Number(it.unit_price),
        lineTotal: Number(it.line_total),
        serviceDate: it.service_date,
      }));

      // 1) Email al host (notificación)
      if (hostEmail && itemsMapped.length > 0) {
        const { subject, html } = renderServiceOrderPaidHostEmail({
          hostName,
          guestName: order.guest_name,
          guestPhone: order.guest_phone,
          guestEmail: order.guest_email,
          total: Number(order.total_amount),
          currency: order.currency,
          paymentId: captureResult.id,
          items: itemsMapped,
          notes: order.notes,
          dashboardUrl: `${baseUrl}/dashboard?panel=upsells`,
        });
        await sendEmail({
          to: hostEmail,
          subject,
          html,
          replyTo: order.guest_email,
          fromName: "StayHost",
        });
      }

      // 2) Email al huésped (confirmación) — solo si dejó email.
      if (order.guest_email && itemsMapped.length > 0) {
        const { subject, html } = renderServiceOrderPaidGuestEmail({
          guestName: order.guest_name,
          hostName,
          hostWhatsapp,
          hostEmail,
          total: Number(order.total_amount),
          currency: order.currency,
          paymentId: captureResult.id,
          items: itemsMapped,
        });
        await sendEmail({
          to: order.guest_email,
          subject,
          html,
          replyTo: hostEmail,
          fromName: `${hostName} via StayHost`,
        });
      }
    } catch (emailErr) {
      console.error("[service-order/paypal/capture] email failed (non-fatal):", emailErr);
    }
  }

  return NextResponse.json({
    ok: true,
    paymentId: captureResult.id,
    payerEmail: captureResult.payerEmail,
  });
}
