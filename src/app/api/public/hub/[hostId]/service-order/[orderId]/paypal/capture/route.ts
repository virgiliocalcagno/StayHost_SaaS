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
import { renderServiceOrderVendorEmail } from "@/lib/email/templates/service-order-vendor";
import { sendPushToVendor } from "@/lib/push/web-push";

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
    .select(
      "id, tenant_id, status, total_amount, currency, paid_at, customer_token, guest_name, guest_email, guest_phone, notes, redemption_pin, redemption_token",
    )
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
    redemption_pin: string | null;
    redemption_token: string | null;
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
    captureId: string | null;
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
  // Sprint 7 — token único para el vendor que va en el email (?k=...).
  // Diferente del redemption_token que el huésped ve en su QR/PIN. Sin
  // este, alguien con solo el QR del huésped puede VER la orden pero no
  // confirmar/declinar/marcar entregada.
  const vendorActionToken = crypto.randomUUID();

  const { data: updated, error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_provider: "paypal",
      payment_id: captureResult.id,
      // capture_id es el que usamos para refunds. Si por alguna razón no
      // vino en la respuesta (raro, pero raw API), queda NULL y el endpoint
      // de refund hace fallback consultando GET /v2/checkout/orders/{id}.
      payment_capture_id: captureResult.captureId,
      vendor_action_token: vendorActionToken,
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
          .select(
            "name, quantity, pricing_model, unit_price, line_total, service_date, service_time, pickup_location, flight_number, extra_notes, vendor_id",
          )
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

      const rawItems = (items ?? []) as Array<{
        name: string; quantity: number; pricing_model: string;
        unit_price: string | number; line_total: string | number;
        service_date: string | null;
        service_time: string | null;
        pickup_location: string | null;
        flight_number: string | null;
        extra_notes: string | null;
        vendor_id: string | null;
      }>;

      const itemsMapped = rawItems.map((it) => ({
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
          // Sprint 6 — pase de entrega visible en el email
          redemptionPin: order.redemption_pin,
          orderUrl: `${baseUrl}/hub/${encodeURIComponent(hostId)}/orden/${encodeURIComponent(order.id)}?t=${encodeURIComponent(customerToken)}`,
        });
        await sendEmail({
          to: order.guest_email,
          subject,
          html,
          replyTo: hostEmail,
          fromName: `${hostName} via StayHost`,
        });
      }

      // 3) Email al/los VENDOR(es) — Sprint 7. Un email por vendor, con
      // todos los items que le tocan. Skip si el vendor está configurado
      // como 'whatsapp_manual' (el host le avisa él).
      // Skip además si la orden no tiene redemption_token (no debería
      // pasar con orders post-Sprint 6, pero blindamos).
      if (order.redemption_token && rawItems.length > 0) {
        // Agrupar items por vendor_id, ignorando los sin vendor (el host
        // los entrega directo, no hace falta notificar a un tercero).
        const itemsByVendor = new Map<string, typeof rawItems>();
        for (const it of rawItems) {
          if (!it.vendor_id) continue;
          const arr = itemsByVendor.get(it.vendor_id) ?? [];
          arr.push(it);
          itemsByVendor.set(it.vendor_id, arr);
        }

        if (itemsByVendor.size > 0) {
          const vendorIds = Array.from(itemsByVendor.keys());
          const { data: vendors } = await supabaseAdmin
            .from("upsell_vendors")
            .select("id, name, display_name, email, phone, notification_channels")
            .in("id", vendorIds)
            .eq("tenant_id", order.tenant_id);

          type VendorRow = {
            id: string;
            name: string;
            display_name: string | null;
            email: string | null;
            phone: string | null;
            notification_channels: unknown;
          };

          for (const v of ((vendors ?? []) as VendorRow[])) {
            const channels = Array.isArray(v.notification_channels)
              ? (v.notification_channels as string[])
              : ["email", "whatsapp_manual", "push"];
            const vendorItems = itemsByVendor.get(v.id) ?? [];
            if (vendorItems.length === 0) continue;

            const vendorTotal = vendorItems.reduce(
              (s, it) => s + Number(it.line_total),
              0,
            );

            const manageUrl =
              `${baseUrl}/v/${encodeURIComponent(order.redemption_token!)}` +
              `?k=${encodeURIComponent(vendorActionToken)}`;

            // Sprint 7.6 — rutea por canales habilitados por el host.
            const firstItemName = vendorItems[0]?.name ?? "Nueva orden";
            const extraItemsLabel = vendorItems.length > 1
              ? ` (+${vendorItems.length - 1} más)`
              : "";

            // PUSH — instantáneo, gratis. Skip si el host no lo habilitó.
            if (channels.includes("push")) {
              await sendPushToVendor({
                vendorId: v.id,
                payload: {
                  title: `🛎 Nueva orden de ${order.guest_name}`,
                  body: `${firstItemName}${extraItemsLabel} — abrí para confirmar.`,
                  url: manageUrl,
                  tag: `order-${order.id.slice(0, 8)}`,
                },
              }).catch((pErr) => {
                console.error(
                  `[capture] vendor push failed for vendor ${v.id}:`,
                  pErr,
                );
              });
            }

            // WHATSAPP BUSINESS — Meta Cloud API auto. El helper es no-op
            // hasta que Virgilio configure las env vars de Meta. Requiere
            // que el vendor tenga phone registrado.
            if (channels.includes("whatsapp_business") && v.phone) {
              const { sendWhatsAppBusinessOrderNotice } = await import(
                "@/lib/whatsapp/meta-cloud"
              );
              await sendWhatsAppBusinessOrderNotice({
                vendorPhone: v.phone,
                vendorName: v.display_name ?? v.name,
                guestName: order.guest_name,
                summary: `${firstItemName}${extraItemsLabel}`,
                manageUrl,
              }).catch((wErr) => {
                console.error(
                  `[capture] WhatsApp Business failed for vendor ${v.id}:`,
                  wErr,
                );
              });
            }

            // EMAIL — solo si canal habilitado Y vendor tiene email.
            if (!channels.includes("email")) continue;
            if (!v.email) continue;

            const { subject, html } = renderServiceOrderVendorEmail({
              vendorName: v.display_name ?? v.name,
              hostName,
              orderId: order.id,
              guestName: order.guest_name,
              guestPhone: order.guest_phone,
              guestEmail: order.guest_email,
              total: vendorTotal,
              currency: order.currency,
              items: vendorItems.map((it) => ({
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
              to: v.email,
              subject,
              html,
              replyTo: hostEmail,
              fromName: `${hostName} via StayHost`,
            }).catch((vErr) => {
              console.error(
                `[capture] vendor email failed for vendor ${v.id}:`,
                vErr,
              );
            });
          }

          // Marcar timestamp del envío para evitar re-envíos.
          await supabaseAdmin
            .from("service_orders")
            .update({ vendor_email_sent_at: new Date().toISOString() } as never)
            .eq("id", order.id);
        }
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
