/**
 * Crea o quita la cleaning_task asociada a un BLOQUEO segun el flag
 * `requires_cleaning`. Las reservas reales generan task siempre (lo hace
 * `ensure-tasks.ts`); los bloqueos solo cuando el host marca el flag.
 *
 * Casos en los que el host querria limpieza despues de un bloqueo:
 *   - mantenimiento: despues de una obra hay que limpiar
 *   - personal:      el host tambien ensucia
 *   - pre_booking:   un huesped real va a llegar
 * Para "other" o cuando el host explicitamente desmarca, no se crea task.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

const DEFAULT_BLOCK_CHECKLIST = [
  { id: "b1", label: "Limpieza profunda post-bloqueo", done: false, type: "general" },
  { id: "b2", label: "Cambiar sabanas y toallas", done: false, type: "general" },
  { id: "b3", label: "Verificar inventario", done: false, type: "general" },
  { id: "b4", label: "Control Remoto TV", done: false, type: "appliance" },
  { id: "b5", label: "Aire Acondicionado", done: false, type: "appliance" },
];

const BLOCK_TYPE_LABELS: Record<string, string> = {
  maintenance: "Mantenimiento",
  personal: "Uso personal",
  pre_booking: "Pre-reserva",
  other: "Bloqueo",
};

export async function ensureCleaningTaskForBlock(args: {
  supabase: AnySupabase;
  tenantId: string;
  bookingId: string;
  propertyId: string;
  checkOut: string;
  blockType: string | null;
}): Promise<{ created: boolean }> {
  const { supabase, tenantId, bookingId, propertyId, checkOut, blockType } = args;

  // Idempotente: si ya hay task con este booking_id, no creamos otra.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from("cleaning_tasks") as any)
    .select("id")
    .eq("booking_id", bookingId)
    .limit(1);

  if (existing && existing.length > 0) return { created: false };

  // La hora de la limpieza es el check-out de la propiedad. Si no esta
  // configurado, default 12:00.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prop } = await (supabase.from("properties") as any)
    .select("check_out_time")
    .eq("id", propertyId)
    .single();

  const dueTime = prop?.check_out_time ?? "12:00";
  const label = BLOCK_TYPE_LABELS[blockType ?? "other"] ?? "Bloqueo";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("cleaning_tasks") as any).insert({
    id: `block-${bookingId}`,
    property_id: propertyId,
    tenant_id: tenantId,
    booking_id: bookingId,
    due_date: checkOut,
    due_time: dueTime,
    status: "pending",
    priority: "medium",
    is_back_to_back: false,
    is_vacant: true,
    guest_name: label,
    guest_count: 0,
    checklist_items: DEFAULT_BLOCK_CHECKLIST,
  });

  if (error) {
    console.error("[ensureCleaningTaskForBlock] insert failed:", error.message);
    return { created: false };
  }
  return { created: true };
}

/**
 * Quita la cleaning_task asociada al bloqueo. Solo borra si esta pending o
 * in_progress — completed se mantiene como historial (igual que la regla
 * de cascadeCancelBooking).
 */
export async function removeCleaningTaskForBlock(args: {
  supabase: AnySupabase;
  bookingId: string;
}): Promise<{ removed: number }> {
  const { supabase, bookingId } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase.from("cleaning_tasks") as any)
    .delete({ count: "exact" })
    .eq("booking_id", bookingId)
    .neq("status", "completed");

  if (error) {
    console.error("[removeCleaningTaskForBlock] delete failed:", error.message);
    return { removed: 0 };
  }
  return { removed: count ?? 0 };
}
