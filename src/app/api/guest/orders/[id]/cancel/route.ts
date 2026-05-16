/**
 * POST /api/guest/orders/[id]/cancel
 *
 * Cliente solicita cancelar una orden propia. Reglas:
 *
 *   1) Solo aplica si order.guest_auth_user_id == user.id (es SU orden).
 *      O si guest_email matchea (orders pre-registro vinculadas retroactivo).
 *
 *   2) Si vendor_status == 'delivered'        → 422 (servicio entregado)
 *   3) Si refunded_at != null                 → 422 (ya cancelada)
 *   4) Si cancellation_requested_at != null   → 422 (ya pidió, esperá)
 *
 *   5) Si vendor_status == 'confirmed'        → REQUEST (host decide)
 *   6) Si todos los items tienen service_date Y still beyond cutoff_hours
 *      Y vendor_status == 'awaiting'          → AUTO-CANCEL con refund inmediato
 *
 * Body: { reason?: string }
 * Response:
 *   { ok: true, mode: 'auto-cancelled', refundPaymentId, amount }
 *   { ok: true, mode: 'request-pending', message }
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRefundForOrder } from "@/lib/upsell/refund-service";
import { sendEmail } from "@/lib/email/send";
import { sendPushToHost } from "@/lib/push/web-push";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión para cancelar." }, { status: 401 });
  }

  let body: { reason?: string } = {};
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    /* body opcional */
  }
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;

  // Lookup order. Validamos ownership por guest_auth_user_id O guest_email
  // (mismo patrón que /api/guest/me linkeo retroactivo).
  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, vendor_status, refunded_at, cancellation_requested_at, cancellation_decision, guest_auth_user_id, guest_name, guest_email, total_amount, currency",
    )
    .eq("id", id)
    .maybeSingle();

  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
  }
  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    vendor_status: string;
    refunded_at: string | null;
    cancellation_requested_at: string | null;
    cancellation_decision: string | null;
    guest_auth_user_id: string | null;
    guest_name: string;
    guest_email: string | null;
    total_amount: string | number;
    currency: string;
  };

  // Ownership check.
  const ownByAuthId = order.guest_auth_user_id === user.id;
  const ownByEmail =
    !!user.email &&
    !!order.guest_email &&
    user.email.toLowerCase() === order.guest_email.toLowerCase();
  if (!ownByAuthId && !ownByEmail) {
    return NextResponse.json({ error: "Esta orden no es tuya." }, { status: 403 });
  }

  // Pre-checks.
  if (order.status !== "paid" && order.status !== "completed") {
    return NextResponse.json(
      { error: `No se puede cancelar en estado "${order.status}".` },
      { status: 422 },
    );
  }
  if (order.vendor_status === "delivered") {
    return NextResponse.json(
      { error: "El servicio ya fue entregado — no se puede cancelar." },
      { status: 422 },
    );
  }
  if (order.refunded_at) {
    return NextResponse.json(
      { error: "Esta orden ya fue reembolsada." },
      { status: 422 },
    );
  }
  if (order.cancellation_requested_at && !order.cancellation_decision) {
    return NextResponse.json(
      { error: "Ya pediste cancelar esta orden. El host está revisando." },
      { status: 422 },
    );
  }

  // Cargar items para evaluar cutoff.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select("service_date, upsell_id")
    .eq("order_id", order.id);
  const itemRows = (items ?? []) as Array<{ service_date: string | null; upsell_id: string | null }>;

  // Cargar cutoff_hours por upsell.
  const upsellIds = Array.from(
    new Set(itemRows.map((i) => i.upsell_id).filter((v): v is string => !!v)),
  );
  let cutoffMap = new Map<string, number>();
  if (upsellIds.length > 0) {
    const { data: ups } = await supabaseAdmin
      .from("upsells")
      .select("id, cutoff_hours")
      .in("id", upsellIds);
    cutoffMap = new Map(
      ((ups ?? []) as Array<{ id: string; cutoff_hours: number }>).map((u) => [
        u.id,
        u.cutoff_hours,
      ]),
    );
  }

  // Evaluar si TODOS los items están "beyond cutoff" — solo así auto-cancela.
  // Si al menos uno está dentro del cutoff, va a request mode.
  const now = Date.now();
  let allBeyondCutoff = true;
  for (const it of itemRows) {
    if (!it.service_date) continue; // sin fecha → no es time-bound, beyond cutoff
    const cutoffHrs = it.upsell_id ? cutoffMap.get(it.upsell_id) ?? 0 : 0;
    const serviceTs = new Date(it.service_date + "T00:00:00Z").getTime();
    const cutoffTs = now + cutoffHrs * 3600 * 1000;
    if (serviceTs <= cutoffTs) {
      allBeyondCutoff = false;
      break;
    }
  }

  // Modo AUTO-CANCEL solo si vendor_status='awaiting' Y todos beyond cutoff.
  // Si vendor_status='confirmed', vendor ya se preparó → requiere aprobación.
  const canAutoCancel = allBeyondCutoff && order.vendor_status === "awaiting";

  if (canAutoCancel) {
    // Ejecutar refund directo + marcar como cancelada.
    const result = await executeRefundForOrder({
      orderId: order.id,
      noteToPayer: reason
        ? `Cancelación del huésped: ${reason}`
        : "Cancelación del huésped pre-cutoff.",
      internalNote: reason ?? "Cancelación auto pre-cutoff.",
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: 502 },
      );
    }

    await supabaseAdmin
      .from("service_orders")
      .update({
        cancellation_requested_at: new Date().toISOString(),
        cancellation_requested_by: "guest",
        cancellation_reason: reason,
        cancellation_decided_at: new Date().toISOString(),
        cancellation_decision: "approved",
        cancellation_decided_by: "guest_self",
      } as never)
      .eq("id", order.id);

    // Notif al host: orden cancelada (informativa, no requiere acción).
    try {
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("name, company, contact_email, email, shop_contact_email")
        .eq("id", order.tenant_id)
        .maybeSingle();
      const tRow = tenant as {
        name: string | null; company: string | null;
        contact_email: string | null; email: string;
        shop_contact_email: string | null;
      } | null;
      // Sprint 8c — contacto operativo de tienda > owner.
      const hostEmail =
        tRow?.shop_contact_email ?? tRow?.contact_email ?? tRow?.email ?? null;
      const hostName = tRow?.company || tRow?.name || "Host";

      if (hostEmail) {
        await sendEmail({
          to: hostEmail,
          subject: `↩️ Huésped canceló: ${order.guest_name}`,
          fromName: "StayHost",
          html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
<p style="font-size:11px;color:#64748b;letter-spacing:1px;text-transform:uppercase">Cancelación pre-cutoff</p>
<h2 style="margin:8px 0">${escapeHtml(order.guest_name)} canceló su pedido</h2>
<p style="color:#475569;line-height:1.6">Hola ${escapeHtml(hostName)}, el cliente canceló dentro de la ventana permitida (antes del cutoff). El reembolso ya se procesó automático.</p>
${reason ? `<p style="background:#fff;border-left:3px solid #94a3b8;padding:12px;margin:12px 0;font-style:italic">"${escapeHtml(reason)}"</p>` : ""}
<p style="color:#475569;font-size:13px">Total reembolsado: ${escapeHtml(formatMoney(Number(order.total_amount), order.currency))}</p>
</div>`,
        });
      }
      await sendPushToHost({
        tenantId: order.tenant_id,
        payload: {
          title: `↩️ Huésped canceló: ${order.guest_name}`,
          body: `Reembolso automático procesado: ${formatMoney(Number(order.total_amount), order.currency)}`,
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin}/dashboard?panel=upsells`,
          tag: `cancel-${order.id.slice(0, 8)}`,
        },
      }).catch(() => {});
    } catch (e) {
      console.error("[guest-cancel] host notif failed:", e);
    }

    return NextResponse.json({
      ok: true,
      mode: "auto-cancelled",
      refundPaymentId: result.ok ? result.refundPaymentId : null,
      amount: result.ok ? result.amount : Number(order.total_amount),
      message: "Tu pedido se canceló y el reembolso ya está en proceso en PayPal.",
    });
  }

  // ── REQUEST MODE: host debe aprobar ──
  await supabaseAdmin
    .from("service_orders")
    .update({
      cancellation_requested_at: new Date().toISOString(),
      cancellation_requested_by: "guest",
      cancellation_reason: reason,
    } as never)
    .eq("id", order.id);

  // Notif al host.
  try {
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("name, company, contact_email, email")
      .eq("id", order.tenant_id)
      .maybeSingle();
    const tRow = tenant as {
      name: string | null; company: string | null;
      contact_email: string | null; email: string;
    } | null;
    const hostEmail = tRow?.contact_email ?? tRow?.email ?? null;
    const hostName = tRow?.company || tRow?.name || "Host";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    if (hostEmail) {
      await sendEmail({
        to: hostEmail,
        subject: `⚠️ Cancelación pedida por ${order.guest_name}`,
        fromName: "StayHost",
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
<p style="font-size:11px;color:#dc2626;letter-spacing:1px;text-transform:uppercase">⚠️ Decisión requerida</p>
<h2 style="margin:8px 0">${escapeHtml(order.guest_name)} pidió cancelar</h2>
<p style="color:#475569;line-height:1.6">El cliente pidió cancelar fuera de la ventana automática (o el vendor ya confirmó). <strong>Tenés 24h para decidir</strong> — si no respondés, se aprueba automático.</p>
${reason ? `<p style="background:#fff;border-left:3px solid #f59e0b;padding:12px;margin:12px 0;font-style:italic">"${escapeHtml(reason)}"</p>` : ""}
<a href="${baseUrl}/dashboard?panel=upsells" style="display:block;background:#1e293b;color:#fff;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;margin-top:20px">Decidir desde el panel →</a>
</div>`,
      });
    }
    await sendPushToHost({
      tenantId: order.tenant_id,
      payload: {
        title: `⚠️ Cancelación pedida: ${order.guest_name}`,
        body: reason ?? "Decidí en las próximas 24h o se auto-aprueba.",
        url: `${baseUrl}/dashboard?panel=upsells`,
        tag: `cancel-${order.id.slice(0, 8)}`,
      },
    }).catch(() => {});
  } catch (e) {
    console.error("[guest-cancel] notif failed:", e);
  }

  return NextResponse.json({
    ok: true,
    mode: "request-pending",
    message:
      order.vendor_status === "confirmed"
        ? "El proveedor ya confirmó tu reserva — el host tiene 24h para decidir. Te avisamos cuando responda."
        : "Pedido fuera de la ventana automática — el host tiene 24h para decidir. Te avisamos cuando responda.",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}
