/**
 * POST /api/service-orders/[id]/reassign
 *
 * Reasigna los items de una orden a otro vendor (típico cuando el vendor
 * original declinó). Genera un nuevo vendor_action_token, resetea el
 * estado del vendor a 'awaiting', y manda email al nuevo vendor.
 *
 * Auth: host autenticado + rol MANAGE_ROLES. Solo el dueño de la orden
 * la puede reasignar.
 *
 * Body: {
 *   newVendorId: string,        // vendor del mismo tenant
 *   itemIds?: string[]          // si se omite, reasigna TODOS los items
 *                               // que estaban con el vendor original
 * }
 *
 * Side-effects:
 *   - service_order_items.vendor_id de los items afectados → newVendorId
 *   - service_orders.vendor_status → 'awaiting'
 *   - service_orders.vendor_action_token → nuevo UUID
 *   - service_orders.vendor_decline_reason → null (limpia el motivo viejo)
 *   - email al nuevo vendor (si tiene email + notification_pref != whatsapp_manual)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { renderServiceOrderVendorEmail } from "@/lib/email/templates/service-order-vendor";
import { sendPushToVendor } from "@/lib/push/web-push";

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
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }

  // Role guard.
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

  let body: { newVendorId?: string; itemIds?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const newVendorId = String(body.newVendorId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(newVendorId)) {
    return NextResponse.json({ error: "newVendorId inválido" }, { status: 400 });
  }
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
    : [];

  // Confirmar que la orden es del tenant del caller + leer status.
  const { data: orderRow } = await supabase
    .from("service_orders")
    .select(
      "id, tenant_id, status, redemption_token, paid_at, guest_name, guest_phone, guest_email, currency",
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
    redemption_token: string | null;
    paid_at: string | null;
    guest_name: string;
    guest_phone: string | null;
    guest_email: string | null;
    currency: string;
  };

  // Solo orders paid se pueden reasignar (las cancelled o refunded ya no tienen sentido).
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: `No se pueden reasignar órdenes en estado "${order.status}"` },
      { status: 422 },
    );
  }

  // Validar que el nuevo vendor pertenece al tenant.
  const { data: newVendor } = await supabase
    .from("upsell_vendors")
    .select("id, name, display_name, email, phone, notification_channels, active")
    .eq("id", newVendorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const vendor = newVendor as {
    id: string; name: string; display_name: string | null; email: string | null;
    phone: string | null;
    notification_channels: unknown;
    active: boolean;
  } | null;
  if (!vendor) {
    return NextResponse.json(
      { error: "Vendor no encontrado o no pertenece al tenant" },
      { status: 422 },
    );
  }
  if (!vendor.active) {
    return NextResponse.json(
      { error: "El vendor está inactivo. Activalo antes de reasignar." },
      { status: 422 },
    );
  }

  // Reasignar items: si vienen itemIds, solo esos; si no, todos los items
  // de la orden. Usamos supabaseAdmin acá porque la auth ya pasó.
  let updateQ = supabaseAdmin
    .from("service_order_items")
    .update({ vendor_id: newVendorId } as never)
    .eq("order_id", order.id);
  if (itemIds.length > 0) {
    updateQ = updateQ.in("id", itemIds);
  }
  const { error: itemsErr } = await updateQ;
  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  // Resetear estado del vendor + rotar action_token. El redemption_token y
  // PIN del huésped NO se tocan — su QR/recibo sigue válido.
  const newActionToken = crypto.randomUUID();
  await supabaseAdmin
    .from("service_orders")
    .update({
      vendor_status: "awaiting",
      vendor_action_token: newActionToken,
      vendor_decline_reason: null,
      vendor_declined_at: null,
      vendor_confirmed_at: null,
      // vendor_email_sent_at se actualiza solo si se manda el email.
    } as never)
    .eq("id", order.id);

  // Sprint 7.6 — rutea según canales habilitados para el vendor.
  const channels = Array.isArray(vendor.notification_channels)
    ? (vendor.notification_channels as string[])
    : ["email", "whatsapp_manual", "push"];

  const baseUrlForPush = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const manageUrl = `${baseUrlForPush}/v/${encodeURIComponent(order.redemption_token ?? "")}?k=${encodeURIComponent(newActionToken)}`;

  // Push notification
  if (channels.includes("push")) {
    await sendPushToVendor({
      vendorId: newVendorId,
      payload: {
        title: `🔁 Orden reasignada — ${order.guest_name}`,
        body: "El host te asignó esta orden. Abrí para confirmar.",
        url: manageUrl,
        tag: `order-${order.id.slice(0, 8)}`,
      },
    }).catch((e) => {
      console.error("[reassign] push failed (non-fatal):", e);
    });
  }

  // WhatsApp Business — auto si el canal está habilitado.
  if (channels.includes("whatsapp_business") && vendor.phone) {
    const { sendWhatsAppBusinessOrderNotice } = await import("@/lib/whatsapp/meta-cloud");
    await sendWhatsAppBusinessOrderNotice({
      vendorPhone: vendor.phone,
      vendorName: vendor.display_name ?? vendor.name,
      guestName: order.guest_name,
      summary: "Orden reasignada",
      manageUrl,
    }).catch((e) => {
      console.error("[reassign] WhatsApp Business failed (non-fatal):", e);
    });
  }

  // Email — solo si canal habilitado + vendor tiene email.
  let emailSent = false;
  if (vendor.email && channels.includes("email") && order.redemption_token) {
    try {
      // Cargar items con info completa para el email — solo los del nuevo vendor.
      const { data: items } = await supabaseAdmin
        .from("service_order_items")
        .select(
          "name, quantity, pricing_model, line_total, service_date, service_time, pickup_location, flight_number, extra_notes",
        )
        .eq("order_id", order.id)
        .eq("vendor_id", newVendorId);

      const itemsArr = (items ?? []) as Array<{
        name: string; quantity: number; pricing_model: string;
        line_total: string | number;
        service_date: string | null; service_time: string | null;
        pickup_location: string | null; flight_number: string | null;
        extra_notes: string | null;
      }>;

      if (itemsArr.length > 0) {
        const vendorTotal = itemsArr.reduce((s, it) => s + Number(it.line_total), 0);

        // Tenant name para el email.
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("name, company, contact_email, email")
          .eq("id", tenantId)
          .maybeSingle();
        const tRow = tenant as {
          name: string | null; company: string | null;
          contact_email: string | null; email: string;
        } | null;
        const hostName = tRow?.company || tRow?.name || "Tu host";
        const hostEmail = tRow?.contact_email ?? tRow?.email ?? null;

        const { subject, html } = renderServiceOrderVendorEmail({
          vendorName: vendor.display_name ?? vendor.name,
          hostName,
          orderId: order.id,
          guestName: order.guest_name,
          guestPhone: order.guest_phone,
          guestEmail: order.guest_email,
          total: vendorTotal,
          currency: order.currency,
          items: itemsArr.map((it) => ({
            name: it.name,
            quantity: it.quantity,
            pricingModel: it.pricing_model,
            lineTotal: Number(it.line_total),
            serviceDate: it.service_date,
            serviceTime: it.service_time,
            pickupLocation: it.pickup_location,
            flightNumber: it.flight_number,
            extraNotes: it.extra_notes,
          })),
          manageUrl,
        });
        await sendEmail({
          to: vendor.email,
          subject: `[Reasignada] ${subject}`,
          html,
          replyTo: hostEmail,
          fromName: `${hostName} via StayHost`,
        });
        emailSent = true;
        await supabaseAdmin
          .from("service_orders")
          .update({ vendor_email_sent_at: new Date().toISOString() } as never)
          .eq("id", order.id);
      }
    } catch (e) {
      console.error("[reassign] email failed (non-fatal):", e);
    }
  }

  return NextResponse.json({
    ok: true,
    newVendorId,
    emailSent,
    channels,
  });
}
