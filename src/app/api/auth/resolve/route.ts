import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone, looksLikeEmail } from "@/lib/auth/identity";

/**
 * POST /api/auth/resolve
 *
 * Body: { identifier: string }
 * Response: { email: string }
 *
 * Convierte un identificador de login (email o teléfono) al email real
 * que Supabase Auth espera. El frontend llama esto antes de
 * `signInWithPassword` cuando el usuario ingresa un teléfono.
 *
 * - Si el identifier es email → devuelve el mismo trim+lowercase.
 * - Si parece teléfono → busca en `team_members.phone` (cross-tenant) y
 *   devuelve el `auth_user_id`'s email asociado.
 *
 * Usa supabaseAdmin (service role) para bypass de RLS porque la búsqueda
 * es cross-tenant — el usuario aún no está autenticado, no sabemos su
 * tenant. Devolvemos solo el email, NO datos personales.
 *
 * Mitigación de enumeración: respondemos 200 con `{ email }` aunque el
 * input sea inválido (devolvemos el input tal cual). El error real de
 * "user not found" sale después en signInWithPassword, que es el mismo
 * error que sale para password incorrecto — sin leak.
 */
export async function POST(req: NextRequest) {
  let body: { identifier?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identifier = (body.identifier ?? "").trim();
  if (!identifier) {
    return NextResponse.json({ error: "identifier required" }, { status: 400 });
  }

  // Caso 1: ya es email → devolver tal cual.
  if (looksLikeEmail(identifier)) {
    return NextResponse.json({ email: identifier.toLowerCase() });
  }

  // Caso 2: parece teléfono → buscar el team_member con ese phone.
  const phone = normalizePhone(identifier);
  if (!phone) {
    // No es ni email ni phone válido — devolvemos el input tal cual,
    // signInWithPassword se encargará de rechazarlo.
    return NextResponse.json({ email: identifier });
  }

  const admin = getSupabaseAdmin();
  // Buscamos por phone exacto. Limit 1 — si hay duplicados cross-tenant,
  // el primer match gana (no debería pasar porque cada teléfono debería
  // ser de una persona, pero por defensa).
  const { data, error } = await admin
    .from("team_members")
    .select("auth_user_id")
    .eq("phone", phone)
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  const row = data as { auth_user_id: string | null } | null;
  if (error || !row?.auth_user_id) {
    // No encontrado — devolvemos un email "no existe" para que falle el
    // signInWithPassword igual que credenciales mal. Sin leak.
    return NextResponse.json({ email: `${phone}@stayhost.local` });
  }

  // Buscamos el email del usuario en auth.users.
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(
    String(row.auth_user_id)
  );
  if (userErr || !userData?.user?.email) {
    return NextResponse.json({ email: `${phone}@stayhost.local` });
  }

  return NextResponse.json({ email: userData.user.email });
}
