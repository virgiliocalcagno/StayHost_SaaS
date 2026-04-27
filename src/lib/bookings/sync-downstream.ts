/**
 * Sincroniza todo lo asociado a un booking cuando sus campos cambian.
 *
 * Caso real que motivo este helper: una reserva de Airbnb extiende su
 * check_out de dia 27 al 28. El upsert iCal updatea la fila en bookings,
 * pero la cleaning_task queda en el dia 27, el access_pin valid_to queda
 * el 27, y el PIN en TTLock vence el 27. La limpiadora va el dia 27
 * (cuando el huesped sigue adentro) y el huesped queda sin codigo el 28.
 *
 * Operaciones que hace:
 *   1. cleaning_tasks: UPDATE due_date + guest_name si no estan completed
 *   2. access_pins: UPDATE valid_from + valid_to (segun horarios de la
 *      propiedad) y marca el pin para resync a TTLock
 *
 * Idempotente: si nada cambio, los UPDATEs no afectan filas (count=0). Se
 * puede llamar siempre sin diff previo, pero por costo preferimos que el
 * caller haga el diff y solo invoque si algo cambio.
 *
 * Best-effort: cualquier paso que falle se loguea pero no tira. Una
 * cleaning_task desincronizada es feo, pero peor seria que el sync iCal
 * entero falle y el booking no se importe.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { markPinForSync } from "@/lib/ttlock/sync-pin";

export type SyncDownstreamResult = {
  cleaningTasksUpdated: number;
  pinsUpdated: number;
  pinsMarkedForResync: number;
};

export async function syncBookingDownstream(bookingId: string): Promise<SyncDownstreamResult> {
  const result: SyncDownstreamResult = {
    cleaningTasksUpdated: 0,
    pinsUpdated: 0,
    pinsMarkedForResync: 0,
  };

  // Cargar el estado actual del booking (post-upsert / post-PATCH).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bk } = await (supabaseAdmin.from("bookings") as any)
    .select("id, property_id, source, status, check_in, check_out, guest_name")
    .eq("id", bookingId)
    .maybeSingle();

  if (!bk) return result;
  const booking = bk as {
    id: string;
    property_id: string;
    source: string;
    status: string;
    check_in: string;
    check_out: string;
    guest_name: string | null;
  };

  // Si quedo cancelado, no resync downstream — cascadeCancelBooking ya hizo
  // el cleanup desde el caller que cambio el status.
  if (booking.status === "cancelled") return result;

  // 1) cleaning_tasks → UPDATE due_date y guest_name preservando id e
  // historial. Aplica tanto a tasks de bloqueos como de reservas; si la
  // task esta completed, no la tocamos.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabaseAdmin.from("cleaning_tasks") as any)
      .update(
        {
          due_date: booking.check_out,
          guest_name: booking.guest_name ?? "Reserva",
        },
        { count: "exact" }
      )
      .eq("booking_id", bookingId)
      .neq("status", "completed");
    result.cleaningTasksUpdated = count ?? 0;
  } catch (err) {
    console.error("[syncBookingDownstream] cleaning_tasks update failed:", err);
  }

  // 2) access_pins → UPDATE valid_from / valid_to segun horarios de la
  // propiedad. Marcamos para resync a TTLock para que el codigo en la
  // cerradura tambien se extienda. La sync corre en el cron normal — no
  // bloqueamos esta funcion esperando a TTLock.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prop } = await (supabaseAdmin.from("properties") as any)
      .select("check_in_time, check_out_time")
      .eq("id", booking.property_id)
      .maybeSingle();
    const ciTime = (prop as { check_in_time?: string | null } | null)?.check_in_time ?? "14:00";
    const coTime = (prop as { check_out_time?: string | null } | null)?.check_out_time ?? "12:00";
    const validFrom = new Date(`${booking.check_in}T${ciTime}:00`).toISOString();
    const validTo = new Date(`${booking.check_out}T${coTime}:00`).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pins, count: updCount } = await (supabaseAdmin.from("access_pins") as any)
      .update(
        { valid_from: validFrom, valid_to: validTo },
        { count: "exact" }
      )
      .eq("booking_id", bookingId)
      .eq("status", "active")
      .select("id");

    result.pinsUpdated = updCount ?? 0;

    // Para cada pin actualizado, marcar para resync TTLock. El cron lo
    // retomara segun su backoff. Si no tiene cerradura asignada, el
    // syncPinToLock va a marcar synced sin hacer nada.
    const pinIds = ((pins ?? []) as Array<{ id: string }>).map((p) => p.id);
    for (const pinId of pinIds) {
      try {
        await markPinForSync(pinId);
        result.pinsMarkedForResync += 1;
      } catch (err) {
        console.error("[syncBookingDownstream] markPinForSync failed for", pinId, err);
      }
    }
  } catch (err) {
    console.error("[syncBookingDownstream] access_pins update failed:", err);
  }

  return result;
}
