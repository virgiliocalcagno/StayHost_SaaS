import { supabaseAdmin } from "@/lib/supabase/admin";
import { deleteTTLockPin } from "@/lib/ttlock/delete-pin";

/**
 * Cleanup de todo lo asociado a una reserva cuando se cancela o elimina.
 *
 * Orden de borrado (importa el orden: primero leemos refs, después borramos
 * dependencias externas, por último borramos filas de BD):
 *   1. Leer checkin_records → sacar `id_photo_path` para limpiar Storage
 *   2. Leer access_pins     → sacar `ttlock_pwd_id`, `ttlock_lock_id`,
 *                             `property_id` para revocar PIN físico TTLock
 *   3. Borrar PIN físico en TTLock (best-effort, no bloquea si falla)
 *   4. Borrar foto del bucket `checkin-ids` (best-effort)
 *   5. DELETE checkin_records
 *   6. DELETE access_pins
 *   7. DELETE cleaning_tasks NO completadas — las completed se mantienen
 *      como historial de limpiezas ya hechas. Las pending/assigned/in_progress
 *      asociadas a una reserva cancelada quedaban huerfanas (la limpiadora
 *      seguia viendo la tarea aunque ya no haya huesped).
 *
 * Por qué borramos el PIN TTLock: si un huésped cancela y el código sigue
 * activo hasta `valid_to`, puede seguir entrando a la propiedad durante días
 * o semanas. Riesgo físico real — no podemos dejarlo.
 *
 * Best-effort TTLock: si la API está caída, el token venció o la propiedad
 * ya no tiene cuenta TTLock conectada, logueamos el error y seguimos. No
 * podemos bloquear una cancelación por un fallo externo. Para retry
 * automático futuro, ver cron de TTLock cleanup (PR aparte).
 *
 * Usa `supabaseAdmin` porque corre desde contextos que bypassean RLS
 * (webhooks de iCal, etc.). Los callers que SÍ tienen sesión deberían
 * pre-validar que el booking pertenece al tenant antes de llamar.
 */
export async function cascadeCancelBooking(bookingId: string): Promise<{
  checkinRecordsRemoved: number;
  pinsRemoved: number;
  photosRemoved: number;
  ttlockPinsRevoked: number;
  ttlockPinsFailed: number;
  cleaningTasksRemoved: number;
}> {
  let checkinRecordsRemoved = 0;
  let pinsRemoved = 0;
  let photosRemoved = 0;
  let ttlockPinsRevoked = 0;
  let ttlockPinsFailed = 0;
  let cleaningTasksRemoved = 0;

  // 1) Leer checkin_records ANTES de borrar — necesitamos el path de la foto
  // y el tenant_id para el limpio de Storage.
  const { data: ciRows } = await supabaseAdmin
    .from("checkin_records")
    .select("id, id_photo_path, tenant_id")
    .eq("booking_ref", bookingId);

  // 2) Leer access_pins ANTES de borrar — necesitamos el ttlock_pwd_id y
  // el lock para llamar al delete de TTLock. También el tenant_id porque
  // el helper lo exige para autorizar contra ttlock_accounts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRows } = await (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, ttlock_lock_id, ttlock_pwd_id")
    .eq("booking_id", bookingId);

  // 3) Borrar PIN físico de cada cerradura — paralelo, best-effort.
  const pins = (pinRows ?? []) as Array<{
    id: string;
    tenant_id: string;
    property_id: string | null;
    ttlock_lock_id: string | null;
    ttlock_pwd_id: string | null;
  }>;
  await Promise.all(
    pins.map(async (p) => {
      if (!p.ttlock_pwd_id || !p.ttlock_lock_id) return;
      const result = await deleteTTLockPin({
        tenantId: p.tenant_id,
        propertyId: p.property_id,
        lockId: p.ttlock_lock_id,
        keyboardPwdId: p.ttlock_pwd_id,
      });
      if (result.ok) {
        ttlockPinsRevoked++;
      } else {
        ttlockPinsFailed++;
        console.warn(
          `[cascadeCancelBooking] TTLock delete failed for pin ${p.id} (pwd ${p.ttlock_pwd_id}):`,
          result.reason,
          result.detail ?? ""
        );
      }
    })
  );

  // 4) Borrar fotos del Storage. Batch remove para no disparar N requests.
  const photoPaths = (ciRows ?? [])
    .map((r) => (r as { id_photo_path?: string | null }).id_photo_path)
    .filter((p): p is string => Boolean(p));
  if (photoPaths.length > 0) {
    const { data: removed, error: storageErr } = await supabaseAdmin.storage
      .from("checkin-ids")
      .remove(photoPaths);
    if (storageErr) {
      console.warn("[cascadeCancelBooking] storage remove failed:", storageErr.message);
    } else {
      photosRemoved = removed?.length ?? 0;
    }
  }

  // 5) Borrar checkin_records.
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

  // 6) Borrar access_pins.
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

  // 7) Borrar cleaning_tasks NO completadas. Las completed se mantienen como
  // historial — la limpieza fisica ya ocurrio aunque despues se cancelara
  // la reserva. Las demas (pending/assigned/in_progress/issue/etc.) quedaban
  // colgadas en el panel de Limpiezas confundiendo a la limpiadora.
  try {
    const { error, count } = await supabaseAdmin
      .from("cleaning_tasks")
      .delete({ count: "exact" })
      .eq("booking_id", bookingId)
      .neq("status", "completed");
    if (error) {
      console.error("[cascadeCancelBooking] cleaning_tasks delete error:", error.message);
    } else {
      cleaningTasksRemoved = count ?? 0;
    }
  } catch (err) {
    console.error("[cascadeCancelBooking] cleaning_tasks exception:", err);
  }

  return {
    checkinRecordsRemoved,
    pinsRemoved,
    photosRemoved,
    ttlockPinsRevoked,
    ttlockPinsFailed,
    cleaningTasksRemoved,
  };
}
