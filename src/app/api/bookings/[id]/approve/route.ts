/**
 * POST /api/bookings/[id]/approve
 *
 * Convierte una solicitud del Hub (status='pending_review', source='hub') en
 * una reserva confirmada. Solo el host puede llamar este endpoint (sesion-
 * aware via getAuthenticatedTenant).
 *
 * Body: { totalPrice: number, source?: 'direct' | 'manual' }
 *
 * Validaciones:
 *   - Booking pertenece al tenant del caller (RLS).
 *   - Booking esta en pending_review (no se aprueba dos veces).
 *   - Overlap: si entre la creacion de la solicitud y ahora el host
 *     aprobo OTRA solicitud o cargo una reserva manual en esas fechas,
 *     devolvemos 409 sin tocar nada — el host elige cancelar la solicitud
 *     o renegociar fechas.
 *
 * Side effects (idempotentes, mismo patron que /convert y POST /api/bookings):
 *   - UPDATE atomico con guard `.eq('status', 'pending_review')` para
 *     evitar doble-confirmacion concurrente.
 *   - Genera channel_code SH... y phoneLast4 para el login del huesped.
 *   - ensurePinForBooking (TTLock + access_pins).
 *   - ensureCheckinRecordForBooking.
 *   - ensureCleaningTasksForProperty.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ensurePinForBooking,
  ensureCheckinRecordForBooking,
} from "@/lib/bookings/side-effects";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await ctx.params;
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: { totalPrice?: unknown; source?: unknown };
  try {
    body = (await req.json()) as { totalPrice?: unknown; source?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const totalPrice = Number(body.totalPrice ?? 0);
  if (Number.isNaN(totalPrice) || totalPrice < 0) {
    return NextResponse.json({ error: "totalPrice inválido" }, { status: 400 });
  }
  const newSource =
    body.source === "manual" ? "manual" : "direct"; // default direct

  // Cargar booking — RLS scopeada por tenant del caller.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bk } = await (supabase.from("bookings") as any)
    .select("id, status, source, property_id, check_in, check_out, guest_name, guest_phone, guest_doc, guest_nationality, guest_doc_photo_path")
    .eq("id", bookingId)
    .single();

  if (!bk) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }
  if (bk.status !== "pending_review") {
    return NextResponse.json(
      { error: "La solicitud ya no está en revisión" },
      { status: 409 }
    );
  }

  // Overlap check ANTES de aprobar — entre creacion y ahora el host pudo
  // confirmar otra reserva en las mismas fechas.
  const { data: overlapping } = await supabase
    .from("bookings")
    .select("id, check_in, check_out, guest_name, status")
    .eq("property_id", bk.property_id)
    .neq("id", bookingId)
    .in("status", ["confirmed", "blocked"])
    .lt("check_in", bk.check_out)
    .gt("check_out", bk.check_in)
    .limit(1);

  if (overlapping && overlapping.length > 0) {
    const o = overlapping[0] as {
      id: string; check_in: string; check_out: string;
      guest_name: string; status: string;
    };
    return NextResponse.json(
      {
        error: "Las fechas ya no están disponibles",
        conflict: {
          id: o.id,
          checkIn: o.check_in,
          checkOut: o.check_out,
          guest: o.guest_name,
          status: o.status,
        },
      },
      { status: 409 }
    );
  }

  // Generar channel_code, phoneLast4 y payment_token.
  const channelCode = `SH${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const cleanPhone = String(bk.guest_phone ?? "").replace(/\D/g, "");
  const phoneLast4 = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : null;
  // payment_token: UUID que el huesped usa para acceder a la pagina de
  // pago publica /hub/[hostId]/pay/[token]. Se mantiene aunque el huesped
  // ya haya pagado (sirve como referencia para mostrar status).
  const paymentToken = crypto.randomUUID();

  // UPDATE atomico con guard: el .eq('status', 'pending_review') asegura
  // que solo updateamos si el estado SIGUE siendo solicitud.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr, count: updateCount } = await (supabase.from("bookings") as any)
    .update(
      {
        status: "confirmed",
        source: newSource,
        total_price: totalPrice,
        channel_code: channelCode,
        phone_last4: phoneLast4,
        payment_token: paymentToken,
      },
      { count: "exact" }
    )
    .eq("id", bookingId)
    .eq("status", "pending_review");

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!updateCount) {
    return NextResponse.json(
      { error: "La solicitud cambió de estado mientras la aprobabas" },
      { status: 409 }
    );
  }

  // Side effects best-effort — si fallan, el booking queda confirmado igual
  // y la UI del host sigue funcional. Loggeamos para diagnostico.
  try {
    if (bk.guest_phone) {
      await ensurePinForBooking({
        tenantId,
        propertyId: String(bk.property_id),
        bookingId,
        guestName: bk.guest_name ?? "Huésped",
        guestPhone: bk.guest_phone,
        checkIn: bk.check_in,
        checkOut: bk.check_out,
        source: newSource,
      });
    }
    await ensureCheckinRecordForBooking({
      tenantId,
      propertyId: String(bk.property_id),
      bookingId,
      guestName: bk.guest_name ?? "Huésped",
      guestDoc: bk.guest_doc,
      guestNationality: bk.guest_nationality,
      guestDocPhotoPath: bk.guest_doc_photo_path,
      checkIn: bk.check_in,
      checkOut: bk.check_out,
      source: newSource,
      channelCode,
      phoneLast4,
    });
    await ensureCleaningTasksForProperty({
      supabase: supabaseAdmin,
      tenantId,
      propertyId: String(bk.property_id),
      cutoffDate: bk.check_in,
    });
  } catch (sideErr) {
    console.error("[bookings/approve] side effects failed (non-fatal):", sideErr);
  }

  return NextResponse.json({
    ok: true,
    id: bookingId,
    channelCode,
    phoneLast4,
    paymentToken,
  });
}
