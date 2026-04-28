import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { deleteTTLockPin } from "@/lib/ttlock/delete-pin";

/**
 * DELETE /api/staff-access/[id] — borra la asignación staff↔propiedad.
 *
 * Si hay access_pins activos generados para esta asignación (tareas en
 * curso del staff en esa propiedad), se revocan también — best-effort
 * en TTLock, igual que /api/access-pins delete.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  // Cargar la asignación
  const { data: row } = await supabase
    .from("staff_property_access")
    .select("id, team_member_id, property_id")
    .eq("id", id)
    .maybeSingle<{ id: string; team_member_id: string; property_id: string }>();
  if (!row) return NextResponse.json({ error: "Asignación no encontrada" }, { status: 404 });

  // Buscar access_pins activos para este staff en esa propiedad y revocar
  const { data: activePins } = await supabase
    .from("access_pins")
    .select("id, ttlock_lock_id, ttlock_pwd_id")
    .eq("team_member_id", row.team_member_id)
    .eq("property_id", row.property_id)
    .eq("status", "active");

  for (const pin of (activePins ?? []) as { id: string; ttlock_lock_id: string | null; ttlock_pwd_id: string | null }[]) {
    if (pin.ttlock_lock_id && pin.ttlock_pwd_id) {
      await deleteTTLockPin({
        tenantId,
        propertyId: row.property_id,
        lockId: pin.ttlock_lock_id,
        keyboardPwdId: pin.ttlock_pwd_id,
      }).catch(() => {});
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("access_pins") as any)
      .update({ status: "revoked" })
      .eq("id", pin.id);
  }

  const { error } = await supabase
    .from("staff_property_access")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
