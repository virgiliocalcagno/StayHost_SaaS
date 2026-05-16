/**
 * GET /api/cron/service-reminders
 *
 * Cron Vercel diario que manda recordatorios 24h antes del servicio.
 *
 * Lógica:
 *   1) Lookup órdenes con:
 *        status='paid'
 *        vendor_status in ('awaiting','confirmed')
 *        reminder_sent_at IS NULL
 *        algún item con service_date = mañana (hora local del tenant)
 *   2) Para cada orden:
 *        - Email + push al huésped con PIN
 *        - Email + push al vendor con datos
 *   3) Marcar reminder_sent_at = now()
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}` (env var).
 * Sin esto, cualquiera con la URL podría spammear emails. Vercel manda
 * automaticamente este header desde el cron settings.
 *
 * Schedule (en vercel.json): "0 14 * * *" → todos los días 14:00 UTC =
 * 10:00 AM hora local Punta Cana (UTC-4). Una sola corrida diaria evita
 * costos en Vercel hobby (1 cron/día gratis).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { sendPushToVendor, sendPushToHost } from "@/lib/push/web-push";
import {
  renderReminderGuestEmail,
  renderReminderVendorEmail,
} from "@/lib/email/templates/service-order-reminder";

type OrderRow = {
  id: string;
  tenant_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  customer_token: string;
  total_amount: string | number;
  currency: string;
  redemption_token: string | null;
  redemption_pin: string | null;
  vendor_action_token: string | null;
};

type ItemRow = {
  order_id: string;
  name: string;
  quantity: number;
  pricing_model: string;
  line_total: string | number;
  service_date: string | null;
  service_time: string | null;
  pickup_location: string | null;
  flight_number: string | null;
  vendor_id: string | null;
};

type TenantRow = {
  id: string;
  name: string | null;
  company: string | null;
};

type VendorRow = {
  id: string;
  tenant_id: string;
  name: string;
  display_name: string | null;
  email: string | null;
  notification_channels: unknown;
};

export async function GET(req: NextRequest) {
  // Auth: Vercel cron envía Authorization header con CRON_SECRET.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  // Si CRON_SECRET no está seteado, permitimos el call (modo dev / setup
  // inicial). Una vez configurada la env var, exige Bearer match.

  // Calcular "mañana" en UTC. Aceptamos cualquier item con service_date
  // que matchee la fecha de mañana (LOCAL del tenant idealmente, pero
  // para v1 usamos UTC — la diferencia es ±1 día en bordes raros).
  //
  // Mejora futura (Sprint Z): para cada tenant, calcular su tomorrow en
  // su timezone. Por ahora UTC.
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Buscar items con service_date = mañana, agrupados por orden.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select(
      "order_id, name, quantity, pricing_model, line_total, service_date, service_time, pickup_location, flight_number, vendor_id",
    )
    .eq("service_date", tomorrowStr);

  const allItems = (items ?? []) as ItemRow[];
  if (allItems.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: "No orders for tomorrow" });
  }
  const orderIds = Array.from(new Set(allItems.map((i) => i.order_id)));

  // Cargar órdenes que cumplan condiciones + filtrar las que ya recibieron
  // reminder.
  const { data: orders } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, guest_name, guest_email, guest_phone, customer_token, total_amount, currency, redemption_token, redemption_pin, vendor_action_token",
    )
    .in("id", orderIds)
    .eq("status", "paid")
    .in("vendor_status", ["awaiting", "confirmed"])
    .is("reminder_sent_at", null);

  const orderRows = (orders ?? []) as OrderRow[];
  if (orderRows.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      message: "All eligible orders already reminded",
    });
  }

  // Tenants + vendors en batch.
  const tenantIds = Array.from(new Set(orderRows.map((o) => o.tenant_id)));
  const vendorIds = Array.from(
    new Set(
      allItems
        .filter((i) => orderRows.some((o) => o.id === i.order_id))
        .map((i) => i.vendor_id)
        .filter((v): v is string => !!v),
    ),
  );

  const [{ data: tenants }, { data: vendors }] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("id, name, company")
      .in("id", tenantIds),
    vendorIds.length > 0
      ? supabaseAdmin
          .from("upsell_vendors")
          .select("id, tenant_id, name, display_name, email, notification_channels")
          .in("id", vendorIds)
      : Promise.resolve({ data: [] as VendorRow[] }),
  ]);

  const tenantMap = new Map(((tenants ?? []) as TenantRow[]).map((t) => [t.id, t]));
  const vendorMap = new Map(((vendors ?? []) as VendorRow[]).map((v) => [v.id, v]));

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  let processed = 0;
  const errors: string[] = [];

  for (const order of orderRows) {
    try {
      const tenant = tenantMap.get(order.tenant_id);
      if (!tenant) continue;
      const hostName = tenant.company || tenant.name || "Tu host";

      const myItems = allItems.filter((i) => i.order_id === order.id);
      const itemsForEmail = myItems.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        pricingModel: i.pricing_model,
        lineTotal: Number(i.line_total),
        serviceDate: i.service_date,
        serviceTime: i.service_time,
        pickupLocation: i.pickup_location,
        flightNumber: i.flight_number,
      }));

      // ── Recordatorio al huésped ──
      const orderUrl = order.redemption_token
        ? `${baseUrl}/hub/${encodeURIComponent(order.tenant_id)}/orden/${encodeURIComponent(order.id)}?t=${encodeURIComponent(order.customer_token)}`
        : null;

      if (order.guest_email) {
        const { subject, html } = renderReminderGuestEmail({
          guestName: order.guest_name,
          hostName,
          total: Number(order.total_amount),
          currency: order.currency,
          items: itemsForEmail,
          redemptionPin: order.redemption_pin,
          orderUrl,
        });
        await sendEmail({
          to: order.guest_email,
          subject,
          html,
          fromName: `${hostName} via StayHost`,
        }).catch((e) => {
          console.error(`[cron-reminder] guest email failed ${order.id}:`, e);
        });
      }

      // ── Recordatorio a cada vendor único de la orden ──
      const vendorIdsInOrder = Array.from(
        new Set(myItems.map((i) => i.vendor_id).filter((v): v is string => !!v)),
      );
      for (const vid of vendorIdsInOrder) {
        const vendor = vendorMap.get(vid);
        if (!vendor) continue;
        const channels = Array.isArray(vendor.notification_channels)
          ? (vendor.notification_channels as string[])
          : ["email", "push"];
        const vendorItems = myItems.filter((i) => i.vendor_id === vid);
        if (vendorItems.length === 0) continue;

        const manageUrl = order.redemption_token && order.vendor_action_token
          ? `${baseUrl}/v/${encodeURIComponent(order.redemption_token)}?k=${encodeURIComponent(order.vendor_action_token)}`
          : "";

        // Push al vendor.
        if (channels.includes("push")) {
          await sendPushToVendor({
            vendorId: vid,
            payload: {
              title: `⏰ Mañana atendés a ${order.guest_name}`,
              body: vendorItems[0]?.name ?? "Servicio reservado",
              url: manageUrl,
              tag: `reminder-${order.id.slice(0, 8)}`,
            },
          }).catch((e) => {
            console.error(`[cron-reminder] vendor push failed ${vid}:`, e);
          });
        }

        // Email al vendor.
        if (channels.includes("email") && vendor.email) {
          const { subject, html } = renderReminderVendorEmail({
            vendorName: vendor.display_name ?? vendor.name,
            hostName,
            guestName: order.guest_name,
            guestPhone: order.guest_phone,
            total: vendorItems.reduce((s, i) => s + Number(i.line_total), 0),
            currency: order.currency,
            items: vendorItems.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              pricingModel: i.pricing_model,
              lineTotal: Number(i.line_total),
              serviceDate: i.service_date,
              serviceTime: i.service_time,
              pickupLocation: i.pickup_location,
              flightNumber: i.flight_number,
            })),
            manageUrl,
          });
          await sendEmail({
            to: vendor.email,
            subject,
            html,
            fromName: `${hostName} via StayHost`,
          }).catch((e) => {
            console.error(`[cron-reminder] vendor email failed ${vid}:`, e);
          });
        }
      }

      // ── Push al host también — para que sepa que mañana hay servicio ──
      await sendPushToHost({
        tenantId: order.tenant_id,
        payload: {
          title: `📅 Mañana: ${order.guest_name}`,
          body: `${myItems.length} servicio${myItems.length === 1 ? "" : "s"} para entregar.`,
          url: `${baseUrl}/dashboard?panel=upsells`,
          tag: `reminder-${order.id.slice(0, 8)}`,
        },
      }).catch(() => {
        /* non-fatal */
      });

      // Marcar reminder_sent_at para no re-procesar.
      await supabaseAdmin
        .from("service_orders")
        .update({ reminder_sent_at: new Date().toISOString() } as never)
        .eq("id", order.id);

      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${order.id}: ${msg}`);
      console.error(`[cron-reminder] order ${order.id} failed:`, e);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    totalCandidates: orderRows.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
