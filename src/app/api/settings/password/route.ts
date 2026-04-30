/**
 * POST /api/settings/password — el cliente cambia su propia contraseña.
 *
 * Body: { newPassword: string }
 *
 * Usamos el cliente con sesión (no service role): supabase.auth.updateUser()
 * actualiza la contraseña del user logueado y solamente del user logueado,
 * por eso es seguro sin pedir la contraseña actual (ya está autenticado por
 * cookie httpOnly y el navegador la presenta).
 *
 * Validaciones mínimas: 8+ chars. Supabase también tiene su propia política
 * configurable en el dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { newPassword?: string };
  try {
    body = (await req.json()) as { newPassword?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }
  if (newPassword.length > 100) {
    return NextResponse.json({ error: "La contraseña es demasiado larga" }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
