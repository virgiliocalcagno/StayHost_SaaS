/**
 * GET /api/cron/cancellation-sla
 *
 * Auto-aprueba cancelaciones pendientes que pasaron 24h sin decisión del
 * host. Procesa el refund + notifica al huésped.
 *
 * Auth: Bearer CRON_SECRET (Vercel cron). Sin esto, cualquiera podría
 * disparar auto-aprobaciones masivas.
 *
 * Schedule (vercel.json): cada hora — "0 * * * *". Vercel hobby permite
 * crons frecuentes; los pesados los hacemos diarios.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRefundForOrder } from "@/lib/upsell/refund-service";
import { sendEmail } from "@/lib/email/send";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 24h ago.
  const slaDeadline = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data: pending } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, guest_name, guest_email, total_amount, currency, cancellation_reason",
    )
    .lte("cancellation_requested_at", slaDeadline)
    .is("cancellation_decided_at", null)
    .is("refunded_at", null);

  const orders = (pending ?? []) as Array<{
    id: string;
    tenant_id: string;
    guest_name: string;
    guest_email: string | null;
    total_amount: string | number;
    currency: string;
    cancellation_reason: string | null;
  }>;

  if (orders.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const nowIso = new Date().toISOString();
  let approved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const order of orders) {
    try {
      const result = await executeRefundForOrder({
        orderId: order.id,
        noteToPayer:
          "Cancelación auto-aprobada (host no respondió en 24h).",
        internalNote: `SLA auto-approval. Motivo huésped: ${order.cancellation_reason ?? "(sin motivo)"}`,
      });

      if (!result.ok) {
        failed++;
        errors.push(`${order.id}: ${result.message}`);
        // No marcamos decided — el host puede aún resolver manualmente.
        continue;
      }

      await supabaseAdmin
        .from("service_orders")
        .update({
          cancellation_decided_at: nowIso,
          cancellation_decision: "approved",
          cancellation_decided_by: "system_sla",
        } as never)
        .eq("id", order.id);

      // Notif al huésped — auto-aprobada por SLA.
      if (order.guest_email) {
        const amount = result.ok ? result.amount : Number(order.total_amount);
        await sendEmail({
          to: order.guest_email,
          subject: "✅ Tu cancelación se aprobó automáticamente",
          fromName: "StayHost",
          html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
<p style="font-size:11px;color:#059669;letter-spacing:1px;text-transform:uppercase">✅ Aprobada por SLA</p>
<h2 style="margin:8px 0">Hola ${escapeHtml(order.guest_name)}</h2>
<p style="color:#475569;line-height:1.6">El host no respondió a tu solicitud de cancelación en las 24h. Tu pedido fue cancelado automáticamente y el reembolso de <strong>${escapeHtml(order.currency)} ${amount.toFixed(2)}</strong> ya está en proceso en PayPal.</p>
<p style="color:#475569;font-size:13px">El reembolso aparece en tu cuenta en 5-7 días hábiles.</p>
</div>`,
        }).catch(() => {});
      }
      approved++;
    } catch (e) {
      failed++;
      errors.push(`${order.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    processed: approved,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
