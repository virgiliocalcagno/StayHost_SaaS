/**
 * DELETE /api/settings/account — el cliente elimina su propia cuenta.
 *
 * Body: { confirm: "ELIMINAR" }  (gate humano contra clicks accidentales)
 *
 * Implementación:
 *   - Borra el tenant del usuario autenticado (sus properties, bookings, etc.
 *     caen en cascada por las FKs).
 *   - Borra el auth.users vía service role (sólo se invoca con session válida
 *     del propio usuario, así que no estamos elevando privilegios cruzados).
 *
 * NO es soft delete por ahora: tras "Eliminar cuenta" todo queda destruido.
 * Si en el futuro queremos retención de datos para legales, agregamos una
 * columna deleted_at y movemos a soft delete.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { confirm?: string };
  try {
    body = (await req.json()) as { confirm?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.confirm !== "ELIMINAR") {
    return NextResponse.json(
      { error: 'Para confirmar, enviá { "confirm": "ELIMINAR" }' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  // Resolver tenant del usuario autenticado (NO confiamos en input del cliente).
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const tenantId = (tenant as { id: string } | null)?.id;

  if (tenantId) {
    const { error: delErr } = await admin.from("tenants").delete().eq("id", tenantId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
  if (authErr) {
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
