import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { deleteTTLockPin } from "@/lib/ttlock/delete-pin";

/**
 * DELETE /api/staff-access/[id] — revoca asignación + PIN físico.
 *
 * Best-effort en TTLock: si la cerradura está caída, igual borramos en BD
 * para que el host no quede bloqueado. El PIN huérfano en la cerradura
 * lo limpia el cron de reconcile.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  // Cargar la asignación con su PIN
  const { data: row } = await supabase
    .from("staff_property_access")
    .select("id, access_pin_id, property_id")
    .eq("id", id)
    .maybeSingle<{ id: string; access_pin_id: string | null; property_id: string }>();
  if (!row) return NextResponse.json({ error: "Asignación no encontrada" }, { status: 404 });

  // Si tiene PIN, revocarlo en TTLock primero (best-effort)
  if (row.access_pin_id) {
    const { data: pinRow } = await supabase
      .from("access_pins")
      .select("ttlock_lock_id, ttlock_pwd_id")
      .eq("id", row.access_pin_id)
      .maybeSingle<{ ttlock_lock_id: string | null; ttlock_pwd_id: string | null }>();
    if (pinRow?.ttlock_lock_id && pinRow.ttlock_pwd_id) {
      await deleteTTLockPin({
        tenantId,
        propertyId: row.property_id,
        lockId: pinRow.ttlock_lock_id,
        keyboardPwdId: pinRow.ttlock_pwd_id,
      }).catch(() => {});
    }
    // Marcar el PIN como revocado en BD
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("access_pins") as any)
      .update({ status: "revoked" })
      .eq("id", row.access_pin_id);
  }

  // Borrar la asignación
  const { error } = await supabase
    .from("staff_property_access")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
