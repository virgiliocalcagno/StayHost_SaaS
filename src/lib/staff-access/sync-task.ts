import { syncPinToLock } from "@/lib/ttlock/sync-pin";
import { deleteTTLockPin } from "@/lib/ttlock/delete-pin";

/**
 * Reconcilia el access_pin de TTLock para una tarea de limpieza.
 *
 * - Si la tarea está ACTIVA (assigned/accepted/in_progress) Y hay assignee
 *   Y el assignee tiene staff_property_access en esa propiedad → crea o
 *   refresca un access_pin period (8am-6pm hora local de RD del día de la
 *   tarea) con el pin_code fijo del staff. Lo sincroniza con TTLock.
 *
 * - Si la tarea está completed/cancelled/rejected, no hay assignee, o no
 *   hay propiedad → revoca todos los access_pins activos del staff anterior
 *   para esa propiedad.
 *
 * Idempotente — se puede llamar múltiples veces sin duplicar PINs.
 *
 * Timezone: hardcodeada a -04:00 (America/Santo_Domingo, sin DST). Cuando
 * tengamos múltiples tenants en zonas distintas, mover a una columna
 * `tenants.timezone`.
 */

const STAFF_WINDOW_START_HOUR = 8;   // 08:00 hora local
const STAFF_WINDOW_END_HOUR = 18;    // 18:00 hora local
const TENANT_TZ_OFFSET = "-04:00";   // RD: UTC-4 todo el año
const ACTIVE_TASK_STATUSES = new Set(["assigned", "accepted", "in_progress"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SBClient = any;

interface SyncArgs {
  supabase: SBClient;
  tenantId: string;
  taskId: string;
}

interface SyncResult {
  ok: boolean;
  action: "activated" | "revoked" | "no_assignment" | "not_found" | "error";
  pinId?: string;
  pin?: string;
  error?: string;
}

/**
 * Construye un Date apuntando a una hora local específica del día indicado,
 * usando el offset de tenant fijo. Sin esto, `new Date(due_date).setHours(8)`
 * usa la hora local DEL SERVIDOR — Vercel corre en UTC, lo que dejaba la
 * ventana 04:00–14:00 hora de RD en lugar de 08:00–18:00.
 */
function buildLocalDate(dateStr: string, hour: number): Date {
  // dateStr puede venir como "2026-04-28" o ISO completo. Tomamos solo la
  // parte de fecha para evitar dobles ajustes.
  const datePart = dateStr.slice(0, 10);
  const hh = String(hour).padStart(2, "0");
  return new Date(`${datePart}T${hh}:00:00${TENANT_TZ_OFFSET}`);
}

export async function syncStaffPinForTask({
  supabase,
  tenantId,
  taskId,
}: SyncArgs): Promise<SyncResult> {
  // Cargar tarea
  const { data: taskRow } = await supabase
    .from("cleaning_tasks")
    .select("id, property_id, assignee_id, status, due_date")
    .eq("id", taskId)
    .maybeSingle();
  if (!taskRow) return { ok: false, action: "not_found", error: "Tarea no encontrada" };

  const isActive =
    ACTIVE_TASK_STATUSES.has(taskRow.status as string) &&
    !!taskRow.assignee_id &&
    !!taskRow.property_id;

  if (!isActive) {
    if (taskRow.property_id && taskRow.assignee_id) {
      await revokeStaffPins({
        supabase,
        tenantId,
        teamMemberId: taskRow.assignee_id as string,
        propertyId: taskRow.property_id as string,
      });
    }
    return { ok: true, action: "revoked" };
  }

  if (!taskRow.due_date) {
    return { ok: false, action: "error", error: "due_date faltante" };
  }

  // Lookup staff_property_access
  const { data: spa } = await supabase
    .from("staff_property_access")
    .select("id, pin_code, is_active")
    .eq("team_member_id", taskRow.assignee_id as string)
    .eq("property_id", taskRow.property_id as string)
    .eq("is_active", true)
    .maybeSingle();
  if (!spa) {
    return { ok: true, action: "no_assignment" };
  }

  // ttlock_lock_id
  const { data: prop } = await supabase
    .from("properties")
    .select("ttlock_lock_id")
    .eq("id", taskRow.property_id as string)
    .maybeSingle();
  const ttlockLockId = (prop?.ttlock_lock_id as string | null) ?? null;

  // Ventana del día en hora local del tenant
  const validFrom = buildLocalDate(taskRow.due_date as string, STAFF_WINDOW_START_HOUR);
  const validTo = buildLocalDate(taskRow.due_date as string, STAFF_WINDOW_END_HOUR);

  // Revocar pines viejos para evitar duplicados
  await revokeStaffPins({
    supabase,
    tenantId,
    teamMemberId: taskRow.assignee_id as string,
    propertyId: taskRow.property_id as string,
  });

  // Crear nuevo access_pin period
  const { data: pinRow, error: pinErr } = await supabase
    .from("access_pins")
    .insert({
      tenant_id: tenantId,
      property_id: taskRow.property_id,
      ttlock_lock_id: ttlockLockId,
      team_member_id: taskRow.assignee_id,
      guest_name: "Staff",
      pin: (spa as { pin_code: string }).pin_code,
      source: "manual",
      status: "active",
      is_cyclic: false,
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
      sync_status: ttlockLockId ? "pending" : "synced",
    })
    .select("id")
    .single();
  if (pinErr || !pinRow) {
    return { ok: false, action: "error", error: pinErr?.message ?? "No se pudo crear el PIN" };
  }
  const pinId = (pinRow as { id: string }).id;

  if (ttlockLockId) {
    void syncPinToLock(pinId).catch(() => {});
  }

  return {
    ok: true,
    action: "activated",
    pinId,
    pin: (spa as { pin_code: string }).pin_code,
  };
}

async function revokeStaffPins(args: {
  supabase: SBClient;
  tenantId: string;
  teamMemberId: string;
  propertyId: string;
}): Promise<void> {
  const { supabase, tenantId, teamMemberId, propertyId } = args;
  const { data: rows } = await supabase
    .from("access_pins")
    .select("id, ttlock_lock_id, ttlock_pwd_id")
    .eq("tenant_id", tenantId)
    .eq("team_member_id", teamMemberId)
    .eq("property_id", propertyId)
    .eq("status", "active");
  for (const p of (rows ?? []) as {
    id: string;
    ttlock_lock_id: string | null;
    ttlock_pwd_id: string | null;
  }[]) {
    if (p.ttlock_lock_id && p.ttlock_pwd_id) {
      await deleteTTLockPin({
        tenantId,
        propertyId,
        lockId: p.ttlock_lock_id,
        keyboardPwdId: p.ttlock_pwd_id,
      }).catch(() => {});
    }
    await supabase
      .from("access_pins")
      .update({ status: "revoked" })
      .eq("id", p.id);
  }
}
