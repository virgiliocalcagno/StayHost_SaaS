import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cierra la sesion server-side.
 *
 * Hacemos signOut desde un route handler en lugar de desde el cliente porque
 * `@supabase/ssr` necesita escribir los `Set-Cookie` de eliminacion en la
 * respuesta HTTP. El signOut del cliente no siempre logra borrar las cookies
 * (depende del adapter), y en preview/prod el resultado es que el middleware
 * sigue viendo la sesion en el siguiente request y rebota al usuario al
 * dashboard sin pedir credenciales.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
