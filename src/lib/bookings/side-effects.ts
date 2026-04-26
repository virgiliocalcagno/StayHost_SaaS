/**
 * Side effects compartidos por el POST de booking y el endpoint /convert.
 *
 * Cuando una reserva nueva existe en bookings, hay que:
 *   1. Crear el PIN de acceso (si guest tiene phone) y sincronizarlo con
 *      la cerradura TTLock si la propiedad esta conectada.
 *   2. Crear el checkin_record para que la reserva aparezca en el panel
 *      de Check-ins sin esperar el autoSync del frontend.
 *
 * Ambos son idempotentes — chequean por booking_id antes de insertar.
 * Errores en cualquiera son non-fatal: el booking ya existe, el host
 * puede recrear el PIN o llenar el checkin manualmente si fallaron.
 *
 * ⚠️ CONTRATO DE TENANCY ⚠️
 * Estos helpers usan supabaseAdmin (bypass de RLS) y escriben con el
 * tenant_id que reciben por argumento. El llamador es responsable de
 * haber validado que ese tenant_id corresponde al usuario autenticado
 * (via getAuthenticatedTenant() o equivalente) ANTES de invocar.
 * Llamarlos con un tenant_id no validado escribiria rows de un tenant
 * en otro — agujero de seguridad.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncPinToLock } from "@/lib/ttlock/sync-pin";

export async function ensurePinForBooking(args: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  source: string;
}): Promise<void> {
  const { tenantId, propertyId, bookingId, guestName, guestPhone, checkIn, checkOut, source } = args;
  const last4 = String(guestPhone).replace(/\D/g, "").slice(-4);
  if (last4.length !== 4) return;

  try {
    // Idempotente: si ya hay PIN para este booking, no recreamos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabaseAdmin.from("access_pins") as any)
      .select("id")
      .eq("booking_id", bookingId)
      .limit(1);
    if (existing && existing.length > 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prop } = await (supabaseAdmin.from("properties") as any)
      .select("ttlock_lock_id, check_in_time, check_out_time")
      .eq("id", propertyId)
      .single();

    const ciTime = prop?.check_in_time ?? "14:00";
    const coTime = prop?.check_out_time ?? "12:00";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedPin } = await (supabaseAdmin.from("access_pins") as any)
      .insert({
        tenant_id: tenantId,
        property_id: propertyId,
        booking_id: bookingId,
        ttlock_lock_id: prop?.ttlock_lock_id ? String(prop.ttlock_lock_id) : null,
        guest_name: guestName,
        guest_phone: guestPhone,
        pin: last4,
        source: source === "block" ? "manual" : "direct_booking",
        status: "active",
        delivery_status: "pending",
        valid_from: new Date(`${checkIn}T${ciTime}:00`).toISOString(),
        valid_to: new Date(`${checkOut}T${coTime}:00`).toISOString(),
      })
      .select("id")
      .single();

    // Sync sincronico contra TTLock. Si falla, syncPinToLock marca la fila
    // como retry con backoff y el cron la retoma despues.
    if (prop?.ttlock_lock_id && insertedPin?.id) {
      try {
        await syncPinToLock(insertedPin.id);
      } catch (err) {
        console.warn("[ensurePinForBooking] initial pin sync threw (will retry):", err);
      }
    }
  } catch (err) {
    console.error("[ensurePinForBooking] failed (non-fatal):", err);
  }
}

export async function ensureCheckinRecordForBooking(args: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  guestName: string;
  guestDoc?: string | null;
  guestNationality?: string | null;
  guestDocPhotoPath?: string | null;
  checkIn: string;
  checkOut: string;
  source: string;
  channelCode: string | null;
  phoneLast4: string | null;
}): Promise<void> {
  const {
    tenantId, propertyId, bookingId,
    guestName, guestDoc, guestNationality, guestDocPhotoPath,
    checkIn, checkOut, source,
    channelCode, phoneLast4,
  } = args;

  try {
    // Idempotente: si ya hay record con este booking_ref, no creamos otro.
    const { data: existing } = await supabaseAdmin
      .from("checkin_records")
      .select("id")
      .eq("booking_ref", bookingId)
      .limit(1);
    if (existing && existing.length > 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prop } = await (supabaseAdmin.from("properties") as any)
      .select("name, address, wifi_name, wifi_password, electricity_enabled, electricity_rate")
      .eq("id", propertyId)
      .single();

    const nights = Math.max(
      1,
      Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)
    );
    const chan = String(source ?? "manual").toLowerCase();
    const isVrbo = chan === "vrbo";
    const propertyElectricityEnabled = prop?.electricity_enabled ?? true;
    const electricityRate = prop?.electricity_rate ?? 0;
    const electricityEnabledForGuest = propertyElectricityEnabled && !isVrbo && electricityRate > 0;
    const electricityTotal = electricityEnabledForGuest ? electricityRate * nights : 0;

    const insertRow: Record<string, unknown> = {
      id: `ci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenant_id: tenantId,
      guest_name: guestName,
      guest_last_name: (channelCode ?? "").toLowerCase().trim(),
      last_four_digits: phoneLast4 ?? "0000",
      checkin: checkIn,
      checkout: checkOut,
      nights,
      property_id: propertyId,
      property_name: prop?.name ?? "Propiedad",
      property_address: prop?.address ?? null,
      wifi_ssid: prop?.wifi_name ?? null,
      wifi_password: prop?.wifi_password ?? null,
      status: "pendiente",
      id_status: "pending",
      source: chan === "ical" || chan === "airbnb" || chan === "vrbo" ? "auto_ical" : "auto_direct",
      channel: chan === "manual" ? "direct" : chan,
      booking_ref: bookingId,
      access_granted: false,
      electricity_enabled: electricityEnabledForGuest,
      electricity_rate: electricityRate,
      electricity_paid: false,
      electricity_total: electricityTotal,
      paypal_fee_included: true,
      missing_data: false,
    };

    if (guestName && guestName !== "Reserva Confirmada" && guestName !== "Huésped") {
      insertRow.ocr_name = guestName;
    }
    if (guestDoc) insertRow.ocr_document = guestDoc;
    if (guestNationality) insertRow.ocr_nationality = guestNationality;
    if (guestDoc || guestNationality) insertRow.ocr_confidence = 1.0;

    if (guestDocPhotoPath) {
      insertRow.id_photo_path = guestDocPhotoPath;
      insertRow.id_status = "validated";
    }

    const { error } = await supabaseAdmin
      .from("checkin_records")
      .insert(insertRow as never);
    if (error) {
      console.error("[ensureCheckinRecordForBooking] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[ensureCheckinRecordForBooking] failed (non-fatal):", err);
  }
}
