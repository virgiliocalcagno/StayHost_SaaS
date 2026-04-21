/**
 * Auto-crea cleaning_tasks para las reservas que todavia no tienen una.
 *
 * Una reserva "merece" una cleaning_task al momento del check_out. Sin esta
 * funcion, las tareas solo se creaban cuando el host abria el modulo
 * Limpiezas (lazy en GET /api/cleaning-tasks) — peligroso, porque si un
 * booking de Airbnb entra a las 3am y el host no entra al modulo, la
 * limpiadora no se entera.
 *
 * Esta funcion se llama desde:
 *  - syncIcalForProperty (cada import), para que el scheduling sea
 *    automatico apenas Airbnb envia la reserva.
 *  - GET /api/cleaning-tasks como fallback (reservas manuales viejas).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

const DEFAULT_CHECKLIST = [
  { id: "c1", label: "Cambiar sábanas y toallas", done: false, type: "general" },
  { id: "c2", label: "Limpieza general", done: false, type: "general" },
  { id: "c3", label: "Verificar inventario", done: false, type: "general" },
  { id: "c4", label: "Control Remoto TV", done: false, type: "appliance" },
  { id: "c5", label: "Aire Acondicionado", done: false, type: "appliance" },
];

type BookingRow = {
  id: string;
  property_id: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  source: string | null;
  num_guests: number | null;
};

export type EnsureTasksResult = {
  created: number;
  skipped: number;
};

export async function ensureCleaningTasksForProperty(args: {
  supabase: AnySupabase;
  tenantId: string;
  propertyId: string;
  cutoffDate?: string; // YYYY-MM-DD — solo considerar bookings con check_out >= cutoff
}): Promise<EnsureTasksResult> {
  const { supabase, tenantId, propertyId } = args;

  const cutoff = args.cutoffDate ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  })();

  // Bookings reales de la propiedad (no bloqueos) desde cutoff.
  // CRITICO: la columna real es `num_guests`, no `guests_count` — el bug
  // anterior silenciaba todas las auto-creaciones de tasks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bookings, error: bkErr } = await (supabase.from("bookings") as any)
    .select("id, property_id, guest_name, check_in, check_out, source, num_guests")
    .eq("property_id", propertyId)
    .gte("check_out", cutoff)
    .neq("status", "cancelled")
    .neq("source", "block");

  if (bkErr || !bookings) return { created: 0, skipped: 0 };
  const bookingList = bookings as BookingRow[];
  if (bookingList.length === 0) return { created: 0, skipped: 0 };

  // Tasks ya existentes con booking_id (para saber cuales saltear).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stored } = await (supabase.from("cleaning_tasks") as any)
    .select("booking_id")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId);

  const existingBookingIds = new Set(
    ((stored ?? []) as { booking_id: string | null }[])
      .map((t) => t.booking_id)
      .filter((v): v is string => !!v),
  );

  const toCreate: Record<string, unknown>[] = [];
  for (const b of bookingList) {
    if (existingBookingIds.has(b.id)) continue;

    // back-to-back: hay otro booking en la misma propiedad que entra el
    // mismo dia que este sale. Limpiadora tiene ventana cerrada.
    const arriving = bookingList.find(
      (o) => o.id !== b.id && o.check_in === b.check_out,
    );
    const isBackToBack = !!arriving;
    const isVacant = !isBackToBack;

    const outDate = new Date(b.check_out);
    const inDate = new Date(b.check_in);
    const nights = Math.max(
      1,
      Math.ceil((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24)),
    );

    toCreate.push({
      id: `booking-${b.id}`,
      property_id: b.property_id,
      tenant_id: tenantId,
      booking_id: b.id,
      due_date: b.check_out,
      due_time: "11:00",
      status: "pending",
      priority: isBackToBack ? "critical" : "medium",
      is_back_to_back: isBackToBack,
      is_vacant: isVacant,
      guest_name: b.guest_name ?? "Huésped",
      guest_count: b.num_guests ?? null,
      stay_duration: nights,
      arriving_guest_name: arriving?.guest_name ?? null,
      arriving_guest_count: arriving?.num_guests ?? null,
      checklist_items: DEFAULT_CHECKLIST,
    });
  }

  if (toCreate.length === 0) {
    return { created: 0, skipped: bookingList.length };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await (supabase.from("cleaning_tasks") as any)
    .upsert(toCreate, { onConflict: "id", ignoreDuplicates: true });

  if (insErr) return { created: 0, skipped: bookingList.length };
  return { created: toCreate.length, skipped: bookingList.length - toCreate.length };
}
