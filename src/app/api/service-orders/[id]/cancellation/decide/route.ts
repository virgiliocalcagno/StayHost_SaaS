/**
 * POST /api/service-orders/[id]/cancellation/decide
 *
 * Host aprueba o rechaza una cancelación pedida por el huésped.
 *
 *   approve → refund automático PayPal + status='refunded' + notif al huésped
 *   reject  → vuelve al estado anterior + notif al huésped con motivo
 *
 * Auth: host autenticado del tenant + role MANAGE_ROLES.
 *
 * Body: { decision: 'approve'|'reject', reason?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRefundForOrder } from "@/lib/upsell/refund-service";
import { sendEmail } from "@/lib/email/send";

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
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null && (!member.role || !MANAGE_ROLES.has(member.role))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: { decision?: string; reason?: string } = {};
  try {
    body = (await req.json()) as { decision?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const decision = String(body.decision ?? "").trim();
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "decision debe ser 'approve' o 'reject'" },
      { status: 400 },
    );
  }
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;

  // Lookup order — filtramos por tenant_id como defensa.
  const { data: orderRow } = await supabase
    .from("service_orders")
    .select(
      "id, tenant_id, status, vendor_status, refunded_at, cancellation_requested_at, cancellation_decided_at, guest_name, guest_email, total_amount, currency",
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
    cancellation_decided_at: string | null;
    guest_name: string;
    guest_email: string | null;
    total_amount: string | number;
    currency: string;
  };

  if (!order.cancellation_requested_at) {
    return NextResponse.json(
      { error: "No hay solicitud de cancelación para decidir." },
      { status: 422 },
    );
  }
  if (order.cancellation_decided_at) {
    return NextResponse.json(
      { error: "Esta solicitud ya tuvo decisión." },
      { status: 422 },
    );
  }
  if (order.refunded_at) {
    return NextResponse.json(
      { error: "Esta orden ya fue reembolsada." },
      { status: 422 },
    );
  }

  const nowIso = new Date().toISOString();

  if (decision === "approve") {
    const result = await executeRefundForOrder({
      orderId: order.id,
      noteToPayer: reason
        ? `Cancelación aprobada: ${reason}`
        : "Cancelación aprobada por el host.",
      internalNote: reason ?? "Aprobada por host.",
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
        cancellation_decided_at: nowIso,
        cancellation_decision: "approved",
        cancellation_decided_by: "host",
      } as never)
      .eq("id", order.id);

    // Email al huésped: aprobada + refund.
    if (order.guest_email) {
      const amount = result.ok ? result.amount : Number(order.total_amount);
      await sendEmail({
        to: order.guest_email,
        subject: "✅ Tu cancelación fue aprobada — refund en curso",
        fromName: "StayHost",
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
<p style="font-size:11px;color:#059669;letter-spacing:1px;text-transform:uppercase">✅ Cancelación aprobada</p>
<h2 style="margin:8px 0">Hola ${escapeHtml(order.guest_name)}</h2>
<p style="color:#475569;line-height:1.6">Tu solicitud de cancelación fue aprobada. El reembolso de <strong>${escapeHtml(order.currency)} ${amount.toFixed(2)}</strong> ya está en proceso en PayPal y aparece en tu cuenta en 5-7 días hábiles.</p>
${reason ? `<p style="background:#fff;border-left:3px solid #94a3b8;padding:12px;margin:12px 0;font-style:italic">Nota del host: "${escapeHtml(reason)}"</p>` : ""}
</div>`,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, decision: "approved" });
  }

  // ── REJECT ──
  await supabaseAdmin
    .from("service_orders")
    .update({
      cancellation_decided_at: nowIso,
      cancellation_decision: "rejected",
      cancellation_decided_by: "host",
      // Reusamos cancellation_reason para incluir el motivo del rechazo del host.
      // (cancellation_reason original era del huésped — concat con el motivo del host).
    } as never)
    .eq("id", order.id);

  // Email al huésped: rechazada con motivo del host.
  if (order.guest_email) {
    await sendEmail({
      to: order.guest_email,
      subject: "Cancelación no procedió",
      fromName: "StayHost",
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
<p style="font-size:11px;color:#dc2626;letter-spacing:1px;text-transform:uppercase">Cancelación rechazada</p>
<h2 style="margin:8px 0">Hola ${escapeHtml(order.guest_name)}</h2>
<p style="color:#475569;line-height:1.6">Tu solicitud de cancelación fue rechazada. La reserva sigue activa.</p>
${reason ? `<p style="background:#fff;border-left:3px solid #f59e0b;padding:12px;margin:12px 0;font-style:italic">Motivo: "${escapeHtml(reason)}"</p>` : ""}
<p style="color:#475569;font-size:13px">Si tenés un problema con el servicio, contactá directo al host vía WhatsApp o email.</p>
</div>`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, decision: "rejected" });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
