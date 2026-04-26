/**
 * POST /api/bookings/[id]/convert
 *
 * Convierte un BLOQUEO MANUAL en una reserva real. Caso tipico: el host
 * crea un bloqueo "pre-reserva" mientras un huesped negocia, y al
 * confirmarse cargamos los datos del huesped y lo transformamos en
 * reserva sin perder el id, las fechas, ni el lugar en el calendario.
 *
 * Validaciones:
 *   - El booking pertenece al tenant (RLS)
 *   - El booking es un bloqueo (source='block', status='blocked')
 *   - Es un bloqueo MANUAL (source_uid LIKE 'manual-%'). Los iCal de
 *     Airbnb/VRBO/Booking NO se convierten — esa reserva existe en la
 *     plataforma origen, manipularla aca seria overbooking en el proximo
 *     sync. Regla: lo que viene por iCal se modifica solo en iCal.
 *   - Body trae al menos guestName, guestPhone, numGuests, totalPrice
 *
 * Side effects:
 *   - UPDATE atomico de bookings: source/status/datos del huesped/precio,
 *     limpia block_type y requires_cleaning, genera channel_code SH....
 *   - Borra la cleaning_task del bloqueo (si tenia requires_cleaning).
 *     El flujo normal de reserva la recreara automaticamente — pero como
 *     ese flujo es por cron / sync iCal, la creamos aca tambien para que
 *     aparezca de inmediato.
 *   - Crea PIN de acceso + checkin_record (mismos helpers que POST).
 *
 * Devuelve channelCode + phoneLast4 → la UI muestra modal "Reserva
 * creada" con link de WhatsApp pre-rellenado, mismo flow que reserva
 * nueva.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ensurePinForBooking,
  ensureCheckinRecordForBooking,
} from "@/lib/bookings/side-effects";
import { removeCleaningTaskForBlock } from "@/lib/cleaning/ensure-block-task";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await ctx.params;
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      guestName, guestPhone, guestDoc, guestNationality, guestDocPhotoPath,
      numGuests, totalPrice, source,
    } = body;

    if (!guestName || !guestPhone) {
      return NextResponse.json(
        { error: "guestName y guestPhone son requeridos" },
        { status: 400 }
      );
    }
    if (numGuests == null || Number.isNaN(Number(numGuests)) || Number(numGuests) < 1) {
      return NextResponse.json(
        { error: "numGuests requerido (numero >= 1)" },
        { status: 400 }
      );
    }
    if (totalPrice == null || Number.isNaN(Number(totalPrice))) {
      return NextResponse.json(
        { error: "totalPrice requerido" },
        { status: 400 }
      );
    }

    // Cargar el bloqueo y validar que se pueda convertir.
    // RLS via supabase (tenant-scoped) — si el booking no es del tenant,
    // single() devuelve null aca.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bk } = await (supabase.from("bookings") as any)
      .select("id, source, source_uid, status, property_id, check_in, check_out")
      .eq("id", bookingId)
      .single();

    if (!bk) {
      return NextResponse.json({ error: "Booking no encontrado" }, { status: 404 });
    }
    if (bk.source !== "block") {
      return NextResponse.json(
        { error: "Solo se pueden convertir bloqueos en reservas" },
        { status: 400 }
      );
    }
    const isManual = typeof bk.source_uid === "string" && bk.source_uid.startsWith("manual-");
    if (!isManual) {
      return NextResponse.json(
        {
          error: "Este bloqueo viene de iCal (Airbnb/VRBO/Booking). Para convertirlo, manejá la reserva en la plataforma origen.",
        },
        { status: 403 }
      );
    }

    // Generar channel_code SH... y phoneLast4.
    const channelCode = `SH${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const cleanPhone = String(guestPhone).replace(/\D/g, "");
    const phoneLast4 = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : null;

    // UPDATE atomico. Limpia block_type y requires_cleaning porque ya no
    // es un bloqueo. La cleaning_task la regeneramos por flujo de reserva
    // mas abajo.
    const updateRow: Record<string, unknown> = {
      source: source ?? "direct",
      status: "confirmed",
      guest_name: guestName,
      guest_phone: guestPhone,
      guest_doc: guestDoc ?? null,
      guest_nationality: guestNationality ?? null,
      guest_doc_photo_path: guestDocPhotoPath ?? null,
      num_guests: Number(numGuests),
      total_price: Number(totalPrice),
      channel_code: channelCode,
      phone_last4: phoneLast4,
      block_type: null,
      requires_cleaning: false,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase.from("bookings") as any)
      .update(updateRow)
      .eq("id", bookingId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Limpiar la cleaning_task del bloqueo (si tenia). Despues
    // ensureCleaningTasksForProperty se encarga de crear la de reserva.
    await removeCleaningTaskForBlock({ supabase: supabaseAdmin, bookingId });

    // PIN de acceso + checkin_record + cleaning_task de reserva.
    await ensurePinForBooking({
      tenantId,
      propertyId: String(bk.property_id),
      bookingId,
      guestName,
      guestPhone,
      checkIn: bk.check_in,
      checkOut: bk.check_out,
      source: source ?? "direct",
    });
    await ensureCheckinRecordForBooking({
      tenantId,
      propertyId: String(bk.property_id),
      bookingId,
      guestName,
      guestDoc,
      guestNationality,
      guestDocPhotoPath,
      checkIn: bk.check_in,
      checkOut: bk.check_out,
      source: source ?? "direct",
      channelCode,
      phoneLast4,
    });
    try {
      await ensureCleaningTasksForProperty({
        supabase: supabaseAdmin,
        tenantId,
        propertyId: String(bk.property_id),
        cutoffDate: bk.check_in,
      });
    } catch (taskErr) {
      console.error("[bookings/convert] cleaning task creation failed (non-fatal):", taskErr);
    }

    return NextResponse.json({
      ok: true,
      id: bookingId,
      channelCode,
      phoneLast4,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
