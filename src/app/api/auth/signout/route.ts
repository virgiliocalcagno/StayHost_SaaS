import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cierra la sesion server-side y borra explicitamente cualquier cookie
 * sb-* que sobreviva al signOut de Supabase.
 *
 * El signOut del cliente browser no siempre logra eliminar las cookies en
 * preview/prod (depende del adapter), por eso hacemos el cierre desde el
 * servidor donde podemos escribir Set-Cookie con expiracion en el pasado.
 *
 * Despues del POST el cliente debe forzar full page load para que el
 * middleware vea las cookies borradas en el siguiente request.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // Si la sesion ya estaba invalida no es un error — igual borramos cookies abajo.
  }

  // Defensa en profundidad: si el signOut no logro borrar alguna cookie sb-*,
  // la matamos a mano. Cubre el caso de cookies de un deploy anterior que
  // tengan otro nombre o options distintas.
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) {
      store.delete(c.name);
    }
  }

  return NextResponse.json({ ok: true });
}
