import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Logout robusto via GET / POST.
 *
 * Es una ruta de Next (no un endpoint de API) para poder linkear directo
 * desde un <a href="/salir"> sin depender de JavaScript. Borra las cookies
 * sb-* server-side y redirige a /acceso. Si JS esta roto o un boton viejo
 * no llama al helper, esta ruta funciona igual.
 */
async function handle(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // Sesion ya invalida — ignoramos.
  }

  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) {
      store.delete(c.name);
    }
  }

  const dest = new URL("/acceso", req.url);
  return NextResponse.redirect(dest, 303);
}

export const GET = handle;
export const POST = handle;
