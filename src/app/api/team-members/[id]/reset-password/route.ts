import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/team-members/[id]/reset-password
 *
 * Body: { password: string }
 *
 * Permite al owner resetear la clave de un miembro del equipo. Útil
 * cuando el staff olvida la contraseña — el owner se la setea manualmente
 * y se la pasa por WhatsApp.
 *
 * Auth: requiere sesión Supabase del owner. Validamos que el team_member
 * pertenece al tenant del owner antes de tocar Auth.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password = body.password ?? "";
  if (password.length < 6) {
    return NextResponse.json(
      { error: "password requerida (mínimo 6 caracteres)" },
      { status: 400 }
    );
  }

  // Validar que el team_member pertenece al tenant del owner. Usamos el
  // cliente con RLS — si no lo encuentra, el owner no tiene acceso.
  const { data: member, error: fetchErr } = await supabase
    .from("team_members")
    .select("id, auth_user_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!member.auth_user_id) {
    return NextResponse.json(
      {
        error:
          "Este miembro no tiene cuenta de acceso. Eliminalo y volvé a crearlo para generar una.",
      },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { error: updateErr } = await admin.auth.admin.updateUserById(
    String(member.auth_user_id),
    { password }
  );

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
