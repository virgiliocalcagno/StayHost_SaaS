import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Diagnostico de sesion. Devuelve si hay user activo y que cookies sb-*
 * llegaron al servidor. Util para debuggear logout que no toma efecto.
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  let user: { id: string; email: string | null } | null = null;
  let err: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) err = error.message;
    if (data.user) user = { id: data.user.id, email: data.user.email ?? null };
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const sbCookies = req.cookies
    .getAll()
    .filter((c) => c.name.startsWith("sb-"))
    .map((c) => ({ name: c.name, valueLen: c.value.length }));

  const res = NextResponse.json({ user, err, sbCookies });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
