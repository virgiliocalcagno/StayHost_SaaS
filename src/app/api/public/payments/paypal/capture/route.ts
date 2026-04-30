/**
 * POST /api/public/payments/paypal/capture
 *
 * El huésped completó la aprobación en PayPal (popup o redirect) y vuelve
 * con el orderId. Capturamos contra las credenciales del host y, si OK,
 * marcamos el booking como paid_at + payment_id.
 *
 * Acepta dos estados de origen:
 *   - status='confirmed' (flow legacy): el host ya había aprobado a mano,
 *     el huésped paga después. Solo agregamos paid_at.
 *   - status='pending_review' + payment_method='paypal' (flow nuevo): el
 *     huésped paga ANTES de que el host apruebe. Si la captura es OK,
 *     auto-confirmamos: status='confirmed', channel_code, side effects
 *     (PIN TTLock, registro de check-in, tareas de limpieza).
 *
 * Body: { paymentToken: string, orderId: string }
 *
 * Idempotencia:
 *   - Si el booking ya está paid_at, devolvemos 200 con ok=true sin
 *     re-capturar (PayPal rechazaría el segundo intento).
 *   - Side effects post-confirmación corren best-effort: si fallan, el
 *     pago queda registrado igual y el host los puede regenerar a mano.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { capturePaypalOrder } from "@/lib/paypal/client";
import {
  ensurePinForBooking,
  ensureCheckinRecordForBooking,
} from "@/lib/bookings/side-effects";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";
import { sendEmail } from "@/lib/email/send";
import { renderGuestPaidEmail } from "@/lib/email/templates/booking-paid-guest";
import { renderHostPaidEmail } from "@/lib/email/templates/booking-paid-host";

export async function POST(req: NextRequest) {
  let body: { paymentToken?: string; orderId?: string };
  try {
    body = (await req.json()) as { paymentToken?: string; orderId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paymentToken = String(body.paymentToken ?? "").trim();
  const orderId = String(body.orderId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(paymentToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }
  if (!orderId) {
    return NextResponse.json({ error: "orderId requerido" }, { status: 400 });
  }

  const { data: bk } = await supabaseAdmin
    .from("bookings")
    .select("id, tenant_id, property_id, status, paid_at, payment_method, check_in, check_out, guest_name, guest_email, guest_phone, guest_doc, guest_nationality, guest_doc_photo_path, num_guests, total_price, phone_last4, channel_code")
    .eq("payment_token", paymentToken)
    .maybeSingle();
  if (!bk) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  const booking = bk as {
    id: string; tenant_id: string; property_id: string; status: string;
    paid_at: string | null; payment_method: string | null;
    check_in: string; check_out: string;
    guest_name: string | null; guest_email: string | null; guest_phone: string | null;
    guest_doc: string | null; guest_nationality: string | null;
    guest_doc_photo_path: string | null;
    num_guests: number | null; total_price: number | null;
    phone_last4: string | null; channel_code: string | null;
  };

  // Aceptar confirmed (legacy) o pending_review con paypal (flow nuevo).
  const acceptable =
    booking.status === "confirmed" ||
    (booking.status === "pending_review" && booking.payment_method === "paypal");
  if (!acceptable) {
    return NextResponse.json({ error: "Reserva no disponible para pago" }, { status: 409 });
  }
  if (booking.paid_at) {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  const { data: cfg } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode, enabled")
    .eq("tenant_id", booking.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfg as {
    id: string; client_id: string | null; client_secret: string | null; mode: string; enabled: boolean;
  } | null;
  if (!config || !config.client_id || !config.client_secret) {
    return NextResponse.json({ error: "Configuración PayPal no encontrada" }, { status: 503 });
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  try {
    const result = await capturePaypalOrder({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      orderId,
    });

    if (result.status !== "COMPLETED") {
      return NextResponse.json(
        { error: `Captura no completada: ${result.status}` },
        { status: 502 }
      );
    }

    // Si venía pending_review (flow nuevo), auto-confirmamos: generamos
    // channel_code y mareamos status='confirmed'. El update incluye un
    // guard de paid_at IS NULL para resolver concurrencia.
    let channelCode = booking.channel_code;
    const needsAutoConfirm = booking.status === "pending_review";
    let updatePayload: Record<string, unknown> = {
      paid_at: new Date().toISOString(),
      payment_provider: "paypal",
      payment_id: result.id,
    };
    if (needsAutoConfirm) {
      channelCode = `SH${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      updatePayload = {
        ...updatePayload,
        status: "confirmed",
        source: "direct",
        channel_code: channelCode,
      };
    }

    const { error: upErr } = await supabaseAdmin
      .from("bookings")
      .update(updatePayload as never)
      .eq("id", booking.id)
      .is("paid_at", null);

    if (upErr) {
      console.error("[paypal/capture] update booking failed:", upErr);
      // El pago se capturó pero no pudimos marcarlo. El host lo va a ver
      // en el dashboard de PayPal igual; debería marcarlo a mano.
    }

    // Side effects post-confirmación — solo si esta captura fue la que
    // confirmó la reserva. Best-effort: errores no abortan la respuesta.
    if (needsAutoConfirm && !upErr) {
      try {
        if (booking.guest_phone) {
          await ensurePinForBooking({
            tenantId: booking.tenant_id,
            propertyId: booking.property_id,
            bookingId: booking.id,
            guestName: booking.guest_name ?? "Huésped",
            guestPhone: booking.guest_phone,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            source: "direct",
          });
        }
        await ensureCheckinRecordForBooking({
          tenantId: booking.tenant_id,
          propertyId: booking.property_id,
          bookingId: booking.id,
          guestName: booking.guest_name ?? "Huésped",
          guestDoc: booking.guest_doc,
          guestNationality: booking.guest_nationality,
          guestDocPhotoPath: booking.guest_doc_photo_path,
          checkIn: booking.check_in,
          checkOut: booking.check_out,
          source: "direct",
          channelCode,
          phoneLast4: booking.phone_last4,
        });
        await ensureCleaningTasksForProperty({
          supabase: supabaseAdmin,
          tenantId: booking.tenant_id,
          propertyId: booking.property_id,
          cutoffDate: booking.check_in,
        });
      } catch (sideErr) {
        console.error("[paypal/capture] side effects failed (non-fatal):", sideErr);
      }
    }

    // Emails post-pago — best-effort, no abortan la respuesta. Mandamos
    // dos emails: recibo al huésped y notificación al host. Resolvemos
    // datos del tenant + property en paralelo. Si Resend no está
    // configurado, sendEmail loguea warning y devuelve ok:false.
    if (!upErr) {
      try {
        const [{ data: prop }, { data: tenant }] = await Promise.all([
          supabaseAdmin
            .from("properties")
            .select("name, address, city, neighborhood")
            .eq("id", booking.property_id)
            .maybeSingle(),
          supabaseAdmin
            .from("tenants")
            .select("name, company, contact_email, owner_whatsapp, hub_welcome_message, email")
            .eq("id", booking.tenant_id)
            .maybeSingle(),
        ]);
        const property = prop as {
          name: string; address: string | null; city: string | null; neighborhood: string | null;
        } | null;
        const tenantRow = tenant as {
          name: string | null; company: string | null;
          contact_email: string | null; owner_whatsapp: string | null;
          hub_welcome_message: string | null; email: string;
        } | null;

        const hostName = tenantRow?.company || tenantRow?.name || "Tu host";
        const hostEmail = tenantRow?.contact_email ?? tenantRow?.email ?? null;
        const hostWhatsapp = tenantRow?.owner_whatsapp ?? null;
        const fullAddress = [property?.address, property?.neighborhood, property?.city]
          .filter(Boolean)
          .join(", ");
        const propertyName = property?.name ?? "Tu propiedad";
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

        // Huésped: solo si tenemos su email guardado.
        if (booking.guest_email) {
          const { subject, html } = renderGuestPaidEmail({
            guestName: booking.guest_name ?? "Huésped",
            channelCode,
            propertyName,
            propertyAddress: fullAddress,
            hostName,
            hostWhatsapp,
            hostEmail,
            hostWelcomeMessage: tenantRow?.hub_welcome_message ?? null,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            numGuests: booking.num_guests,
            total: Number(booking.total_price ?? 0),
            currency: "USD",
            paymentId: result.id,
            payUrl: `${baseUrl}/hub/${booking.tenant_id}/pay/${paymentToken}`,
          });
          await sendEmail({
            to: booking.guest_email,
            subject,
            html,
            replyTo: hostEmail,
            fromName: `${hostName} via StayHost`,
          });
        }

        // Host: siempre, mandamos al email de contacto o al de login.
        if (hostEmail) {
          const { subject, html } = renderHostPaidEmail({
            hostName,
            channelCode,
            propertyName,
            guestName: booking.guest_name ?? "Huésped",
            guestPhone: booking.guest_phone,
            guestEmail: booking.guest_email,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            numGuests: booking.num_guests,
            total: Number(booking.total_price ?? 0),
            currency: "USD",
            paymentId: result.id,
            dashboardUrl: `${baseUrl}/dashboard?panel=direct-bookings`,
          });
          await sendEmail({
            to: hostEmail,
            subject,
            html,
            // El host no responde a este email — es una notificación.
            replyTo: booking.guest_email,
            fromName: "StayHost",
          });
        }
      } catch (emailErr) {
        console.error("[paypal/capture] email failed (non-fatal):", emailErr);
      }
    }

    return NextResponse.json({
      ok: true,
      paymentId: result.id,
      payerEmail: result.payerEmail,
      autoConfirmed: needsAutoConfirm,
      channelCode,
    });
  } catch (err) {
    console.error("[paypal/capture]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error capturando pago" },
      { status: 502 }
    );
  }
}
