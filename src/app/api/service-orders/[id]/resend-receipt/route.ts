/**
 * POST /api/service-orders/[id]/resend-receipt
 *
 * Reenvía al huésped el email de confirmación de su orden (con PIN, items,
 * link al hub). Útil cuando el huésped lo borró, le fue a spam, o perdió
 * el PIN.
 *
 * Auth:
 *   - Sesión del owner/admin/manager/co_host del tenant dueño de la orden.
 *   - RLS de service_orders ya filtra por tenant_id; el lookup re-confirma
 *     que el id pertenece al tenant antes de mandar.
 *
 * Side effects:
 *   - Solo envía email. No cambia estado, no toca tokens, no expone PII.
 *   - Si la orden no tiene guest_email guardado → 422 (no hay a dónde mandar).
 *   - Idempotente: el huésped puede recibir el mismo email N veces.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { renderServiceOrderPaidGuestEmail } from "@/lib/email/templates/service-order-paid-guest";
import { getModuleContactForTenant } from "@/lib/tenant/module-contact";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

type OrderRow = {
  id: string;
  tenant_id: string;
  status: string;
  guest_name: string;
  guest_email: string | null;
  total_amount: string | number;
  currency: string;
  payment_id: string | null;
  notes: string | null;
  customer_token: string | null;
  redemption_pin: string | null;
  receipt_last_resent_at: string | null;
};

// Cooldown anti-spam: el host no puede reenviar el mismo email más de
// una vez cada 60s. Previene clicks accidentales / mala fe.
const RESEND_COOLDOWN_MS = 60_000;

type ItemRow = {
  name: string;
  quantity: number;
  pricing_model: string;
  unit_price: string | number;
  line_total: string | number;
  service_date: string | null;
  service_time: string | null;
  pickup_location: string | null;
  flight_number: string | null;
  extra_notes: string | null;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }

  // Role guard: cleaner/maintenance no debe poder reenviar emails con PII.
  const { data: memberData } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberData as { role: string | null } | null;
  if (member && (!member.role || !MANAGE_ROLES.has(member.role))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // 1. Lookup de la orden (RLS + filtro explícito por tenant).
  const { data: orderRow } = await supabase
    .from("service_orders")
    .select(
      "id, tenant_id, status, guest_name, guest_email, total_amount, currency, payment_id, notes, customer_token, redemption_pin, receipt_last_resent_at",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const order = orderRow as OrderRow | null;
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  if (!order.guest_email) {
    return NextResponse.json(
      { error: "El huésped no dejó email — no hay a dónde reenviar." },
      { status: 422 },
    );
  }

  // Solo tiene sentido reenviar el confirmation email para órdenes pagadas
  // o completadas. Si está pending/cancelled/refunded el huésped no tiene
  // PIN ni info que recibir.
  if (order.status !== "paid" && order.status !== "completed") {
    return NextResponse.json(
      { error: `No se puede reenviar email para órdenes en estado "${order.status}".` },
      { status: 422 },
    );
  }

  // Cooldown anti-spam: si se reenvió hace menos de 60s, rechazar con 429.
  if (order.receipt_last_resent_at) {
    const last = new Date(order.receipt_last_resent_at).getTime();
    const elapsed = Date.now() - last;
    if (elapsed < RESEND_COOLDOWN_MS) {
      const secs = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        {
          error: `Esperá ${secs}s antes de reenviar otra vez.`,
          retryAfterSeconds: secs,
        },
        { status: 429 },
      );
    }
  }

  // 2. Items de la orden.
  const { data: itemsData } = await supabase
    .from("service_order_items")
    .select(
      "name, quantity, pricing_model, unit_price, line_total, service_date, service_time, pickup_location, flight_number, extra_notes",
    )
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const items = (itemsData ?? []) as ItemRow[];

  // 3. Host info (nombre + contacto público) para el email. Usamos el
  // helper que respeta encargados por módulo + fallback al owner. Incluye
  // Auth fallback porque es uso INTERNO (email al huésped CON datos del
  // host como contacto, no expone el email del owner al huésped a menos
  // que no haya contact_email configurado).
  const shopContact = await getModuleContactForTenant(order.tenant_id, "shop", {
    includeAuthEmailFallback: true,
  });
  const hostName = shopContact?.hostName ?? "Tu host";
  const hostEmail = shopContact?.email ?? null;
  const hostWhatsapp = shopContact?.whatsapp ?? null;

  // 4. Mapear items al shape que espera el template.
  const itemsMapped = items.map((i) => ({
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
  }));

  // 5. Renderizar y enviar.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(_req.url).origin;
  const orderUrl = order.customer_token
    ? `${baseUrl}/hub/${encodeURIComponent(order.tenant_id)}/orden/${encodeURIComponent(order.id)}?t=${encodeURIComponent(order.customer_token)}`
    : `${baseUrl}/hub/${encodeURIComponent(order.tenant_id)}`;

  const { subject, html } = renderServiceOrderPaidGuestEmail({
    guestName: order.guest_name,
    hostName,
    hostWhatsapp,
    hostEmail,
    total: Number(order.total_amount),
    currency: order.currency,
    paymentId: order.payment_id ?? "",
    items: itemsMapped,
    redemptionPin: order.redemption_pin,
    orderUrl,
  });

  try {
    await sendEmail({
      to: order.guest_email,
      subject: `(Reenvío) ${subject}`,
      html,
      replyTo: hostEmail ?? undefined,
      fromName: `${hostName} via StayHost`,
    });
  } catch (e) {
    console.error("[resend-receipt] sendEmail failed:", e);
    return NextResponse.json(
      { error: "No se pudo enviar el email. Probá de nuevo." },
      { status: 500 },
    );
  }

  // Marcar timestamp del reenvío para el cooldown. Best-effort — si falla,
  // no rompemos el response (el email ya se mandó). En el peor caso, el
  // cooldown no se activa hasta el próximo reenvío exitoso.
  await supabase
    .from("service_orders")
    .update({ receipt_last_resent_at: new Date().toISOString() } as never)
    .eq("id", order.id)
    .eq("tenant_id", tenantId);

  // No devolvemos `sentTo` para no exponer el email del huésped en logs
  // del cliente. El frontend ya sabe a quién le mandó (tiene la orden).
  return NextResponse.json({ ok: true });
}
