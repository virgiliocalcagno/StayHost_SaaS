import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Logout robusto via GET / POST.
 *
 * Estrategia:
 *   1. signOut con el server client de Supabase para invalidar la sesion
 *      en su backend.
 *   2. Para cada cookie del request que empiece con `sb-`, escribimos
 *      `Set-Cookie` con value vacio, maxAge 0, expires en el pasado, en
 *      DOS variantes (con path / y sin) para cubrir mismatches de path.
 *   3. `Cache-Control: no-store` para que ni el browser ni el CDN cacheen.
 *   4. 303 redirect a /acceso (303 fuerza GET aunque el cliente haya hecho POST).
 *
 * Modo debug: `/salir?debug=1` devuelve JSON con las cookies que vio y las
 * que limpio, sin redirigir. Util para verificar que el logout llega.
 */
async function handle(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  const supabase = await createSupabaseServerClient();
  let userBefore: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userBefore = data.user?.email ?? null;
  } catch {}

  let signOutErr: string | null = null;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) signOutErr = error.message;
  } catch (e) {
    signOutErr = e instanceof Error ? e.message : String(e);
  }

  const incomingSb = req.cookies
    .getAll()
    .filter((c) => c.name.startsWith("sb-"))
    .map((c) => c.name);

  const buildClearedHeaders = (res: NextResponse) => {
    res.headers.set("Cache-Control", "no-store, max-age=0");
    for (const name of incomingSb) {
      res.cookies.set({
        name,
        value: "",
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      });
      res.cookies.set({
        name,
        value: "",
        maxAge: 0,
        expires: new Date(0),
      });
    }
  };

  if (debug) {
    const res = NextResponse.json({
      ok: true,
      userBefore,
      signOutErr,
      sbCookiesSeen: incomingSb,
      cleared: incomingSb,
    });
    buildClearedHeaders(res);
    return res;
  }

  const dest = new URL("/acceso", req.url);
  const res = NextResponse.redirect(dest, 303);
  buildClearedHeaders(res);
  return res;
}

export const GET = handle;
export const POST = handle;
