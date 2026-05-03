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
    // Cookie de rol que setea /api/me — sin esto, si el siguiente usuario
    // del mismo browser es owner, el middleware podría rebotarlo a /staff
    // por el rol heredado del logout anterior.
    res.cookies.set({
      name: "sh_role",
      value: "",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
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

  // Servimos HTML con un <script> que purga localStorage antes de redirigir.
  // No es paranoia: claves como `stayhost_session` y `stayhost_owner_email`
  // sobreviven al logout server-side y filtran rol entre usuarios del mismo
  // browser (Master se desloguea, otro user entra y hereda OWNER + ve SaaS
  // Control). Tambien limpiamos `stayhost_modules_config` para que el plan
  // del proximo user se aplique limpio desde /api/me.
  const accesoUrl = new URL("/acceso", req.url).toString();
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Cerrando sesion...</title>
<meta name="robots" content="noindex" />
<meta http-equiv="refresh" content="2;url=${accesoUrl}" />
<style>
body{margin:0;background:#F8F9FC;color:#475569;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;}
p{font-size:14px;font-weight:500;}
</style>
</head>
<body>
<p>Cerrando sesion...</p>
<script>
(function () {
  try {
    var prefixes = ["stayhost_", "sb-", "supabase."];
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      for (var j = 0; j < prefixes.length; j++) {
        if (keys[i].indexOf(prefixes[j]) === 0) {
          localStorage.removeItem(keys[i]);
          break;
        }
      }
    }
  } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  location.replace(${JSON.stringify(accesoUrl)});
})();
</script>
</body>
</html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  buildClearedHeaders(res);
  return res;
}

export const GET = handle;
export const POST = handle;
