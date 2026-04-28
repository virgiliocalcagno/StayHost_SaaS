import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { syncPinToLock } from "@/lib/ttlock/sync-pin";
import { deleteTTLockPin } from "@/lib/ttlock/delete-pin";

/**
 * POST /api/staff-access/sync-task
 * Body: { taskId }
 *
 * Reconcilia el access_pin de TTLock para una tarea de limpieza:
 *   - Si la tarea está activa (assigned/accepted/in_progress) Y hay assignee
 *     Y el assignee tiene staff_property_access para esa propiedad → crea
 *     o refresca un access_pin period (8am-6pm del día de la tarea) con el
 *     pin_code fijo del staff. Lo sincroniza con TTLock.
 *   - Si la tarea está completed/cancelled/rejected o no hay assignee → revoca
 *     todos los access_pins activos del staff anterior para esa propiedad
 *     en ese día.
 *
 * Idempotente — se puede llamar múltiples veces sin duplicar PINs.
 */

const STAFF_WINDOW_START_HOUR = 8;   // 08:00
const STAFF_WINDOW_END_HOUR = 18;    // 18:00
const ACTIVE_TASK_STATUSES = new Set(["assigned", "accepted", "in_progress"]);

export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const taskId = String(body.taskId ?? "");
  if (!taskId) return NextResponse.json({ error: "taskId requerido" }, { status: 400 });

  // Cargar tarea
  const { data: taskRow } = await supabase
    .from("cleaning_tasks")
    .select("id, property_id, assignee_id, status, due_date")
    .eq("id", taskId)
    .maybeSingle<{
      id: string;
      property_id: string | null;
      assignee_id: string | null;
      status: string;
      due_date: string | null;
    }>();
  if (!taskRow) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  const isActive = ACTIVE_TASK_STATUSES.has(taskRow.status) && !!taskRow.assignee_id && !!taskRow.property_id;

  // Si la tarea YA NO está activa, revocar cualquier PIN del staff actual
  // (o anterior) para esa propiedad. No nos interesa solo el día — el PIN
  // que generamos para ESTA tarea vence solo, pero queremos cerrarlo ahora
  // si la tarea termina/cancela.
  if (!isActive) {
    if (taskRow.property_id && taskRow.assignee_id) {
      await revokeStaffPins({
        supabase,
        tenantId,
        teamMemberId: taskRow.assignee_id,
        propertyId: taskRow.property_id,
        dateIso: taskRow.due_date,
      });
    }
    return NextResponse.json({ ok: true, action: "revoked" });
  }

  const dueDate = taskRow.due_date ? new Date(taskRow.due_date) : new Date();
  if (Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: "due_date inválida" }, { status: 400 });
  }

  // Lookup staff_property_access
  const { data: spa } = await supabase
    .from("staff_property_access")
    .select("id, pin_code, is_active")
    .eq("team_member_id", taskRow.assignee_id!)
    .eq("property_id", taskRow.property_id!)
    .eq("is_active", true)
    .maybeSingle<{ id: string; pin_code: string; is_active: boolean }>();
  if (!spa) {
    // Sin asignación → la tarea sigue, pero no hay PIN para crear.
    return NextResponse.json({ ok: true, action: "no_assignment" });
  }

  // ttlock_lock_id de la propiedad
  const { data: prop } = await supabase
    .from("properties")
    .select("ttlock_lock_id")
    .eq("id", taskRow.property_id!)
    .maybeSingle<{ ttlock_lock_id: string | null }>();
  const ttlockLockId = prop?.ttlock_lock_id ?? null;

  // Ventana del día
  const validFrom = new Date(dueDate);
  validFrom.setHours(STAFF_WINDOW_START_HOUR, 0, 0, 0);
  const validTo = new Date(dueDate);
  validTo.setHours(STAFF_WINDOW_END_HOUR, 0, 0, 0);

  // Revocar pines viejos de DÍAS ANTERIORES o del MISMO día (re-creación) para
  // este staff en esta propiedad. Mantenemos solo el del rango actual.
  await revokeStaffPins({
    supabase,
    tenantId,
    teamMemberId: taskRow.assignee_id!,
    propertyId: taskRow.property_id!,
    dateIso: null, // revocar TODOS los activos para evitar duplicados
  });

  // Crear nuevo access_pin period (no cíclico)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow, error: pinErr } = await (supabase.from("access_pins") as any)
    .insert({
      tenant_id: tenantId,
      property_id: taskRow.property_id,
      ttlock_lock_id: ttlockLockId,
      team_member_id: taskRow.assignee_id,
      guest_name: "Staff",
      pin: spa.pin_code,
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
    return NextResponse.json({ error: pinErr?.message ?? "No se pudo crear el PIN" }, { status: 500 });
  }
  const pinId = (pinRow as { id: string }).id;

  if (ttlockLockId) {
    void syncPinToLock(pinId).catch(() => {});
  }

  return NextResponse.json({ ok: true, action: "activated", pinId, pin: spa.pin_code });
}

// Revoca todos los access_pins activos del staff en esa propiedad. Si
// dateIso viene, filtra solo los del día (no usado por ahora).
async function revokeStaffPins(args: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedTenant>>["supabase"];
  tenantId: string;
  teamMemberId: string;
  propertyId: string;
  dateIso: string | null;
}): Promise<void> {
  const { supabase, tenantId, teamMemberId, propertyId } = args;
  const { data: rows } = await supabase
    .from("access_pins")
    .select("id, ttlock_lock_id, ttlock_pwd_id")
    .eq("tenant_id", tenantId)
    .eq("team_member_id", teamMemberId)
    .eq("property_id", propertyId)
    .eq("status", "active");
  for (const p of (rows ?? []) as { id: string; ttlock_lock_id: string | null; ttlock_pwd_id: string | null }[]) {
    if (p.ttlock_lock_id && p.ttlock_pwd_id) {
      await deleteTTLockPin({
        tenantId,
        propertyId,
        lockId: p.ttlock_lock_id,
        keyboardPwdId: p.ttlock_pwd_id,
      }).catch(() => {});
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("access_pins") as any)
      .update({ status: "revoked" })
      .eq("id", p.id);
  }
}
