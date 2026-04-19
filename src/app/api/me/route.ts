/**
 * /api/me — devuelve la identidad del usuario autenticado.
 *
 * Lee la sesión DESDE EL SERVIDOR (via la cookie httpOnly que maneja
 * @supabase/ssr), por lo que es la fuente de verdad más confiable. El SDK
 * de Supabase en el navegador puede tardar o fallar en reconocer la sesión
 * en incógnito o tras borrar caché; este endpoint no tiene ese problema.
 *
 * Responde:
 *   { email: string | null, tenantId: string | null, isMaster: boolean }
 *
 * Nunca 401 — devuelve nulls cuando no hay sesión, para que el cliente pueda
 * decidir qué hacer sin tener que manejar errores.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const MASTER_EMAIL = "virgiliocalcagno@gmail.com";

export async function GET() {
  const { user, tenantId } = await getAuthenticatedTenant();
  const email = (user?.email ?? "").trim().toLowerCase();
  return NextResponse.json({
    email: email || null,
    tenantId: tenantId ?? null,
    isMaster: email === MASTER_EMAIL,
  });
}
