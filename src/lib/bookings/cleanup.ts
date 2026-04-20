import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Cleanup de todo lo asociado a una reserva cuando se cancela o elimina.
 *
 * Borra/revoca en orden:
 *   1. `checkin_records` vinculados al booking (por `booking_ref = bookingId`)
 *   2. `access_pins` vinculados al booking (por `booking_id`)
 *
 * TODO(ttlock-physical-delete): actualmente los access_pins se borran de la
 * BD pero el PIN físico en la cerradura TTLock sigue activo hasta su
 * `valid_to`. Para el delete físico hay que llamar a TTLock
 * `/v3/keyboardPwd/delete` con el `ttlock_pwd_id` de cada pin. Requiere
 * extraer el helper de refresh_token a `src/lib/ttlock/` y pasarlo por
 * service-role. Scheduleado para PR aparte.
 *
 * Usa `supabaseAdmin` porque corre desde contextos que bypassean RLS
 * (webhooks de iCal, etc.). Los callers que SÍ tienen sesión deberían
 * pre-validar que el booking pertenece al tenant antes de llamar.
 */
export async function cascadeCancelBooking(bookingId: string): Promise<{
  checkinRecordsRemoved: number;
  pinsRemoved: number;
}> {
  let checkinRecordsRemoved = 0;
  let pinsRemoved = 0;

  // 1) Borrar checkin_records asociados. El Source 3 del autoSync del panel
  // CheckIns guarda `booking_ref = bookings.id` (UUID), así que hacemos match
  // directo. Si el registro se creó con otro ref (legado), no se borra —
  // aceptamos el leak porque el checkin_record sin booking es inofensivo.
  try {
    const { error, count } = await supabaseAdmin
      .from("checkin_records")
      .delete({ count: "exact" })
      .eq("booking_ref", bookingId);
    if (error) {
      console.error("[cascadeCancelBooking] checkin_records delete error:", error.message);
    } else {
      checkinRecordsRemoved = count ?? 0;
    }
  } catch (err) {
    console.error("[cascadeCancelBooking] checkin_records exception:", err);
  }

  // 2) Borrar access_pins. Esto también borra el "código de puerta" que usa
  // el huésped. Si el access_pin ya se había sincronizado con TTLock físico,
  // el PIN seguirá funcionando en la cerradura hasta `valid_to` (ver TODO).
  try {
    const { error, count } = await supabaseAdmin
      .from("access_pins")
      .delete({ count: "exact" })
      .eq("booking_id", bookingId);
    if (error) {
      console.error("[cascadeCancelBooking] access_pins delete error:", error.message);
    } else {
      pinsRemoved = count ?? 0;
    }
  } catch (err) {
    console.error("[cascadeCancelBooking] access_pins exception:", err);
  }

  return { checkinRecordsRemoved, pinsRemoved };
}
