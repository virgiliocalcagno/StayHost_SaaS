import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/server";

/**
 * Auth middleware.
 *
 * Runs on every matched request and does two jobs:
 *
 *   1. Refreshes the Supabase session cookie so it doesn't expire mid-session
 *      (this is what `@supabase/ssr` needs from middleware to work at all).
 *
 *   2. Gatekeeps protected routes: if the request targets a protected path
 *      (see PROTECTED_PREFIXES) and there's no logged-in user, redirects to
 *      /acceso for page routes or returns 401 JSON for /api/* routes.
 *
 * The matcher at the bottom filters out static assets and the internal Next
 * folder; everything else flows through this function.
 */

// ── Route classification ────────────────────────────────────────────────────

/**
 * Any request whose pathname starts with one of these is PROTECTED and
 * requires an authenticated user. Everything else is treated as public.
 *
 * Why allowlist public instead of protected? Because an accidental typo on a
 * new route should default to "locked down", not "open".
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/staff",
  "/api/bookings",
  "/api/properties",
  "/api/cleaning-tasks",
  "/api/team-members",
  "/api/tuya",
  "/api/ttlock",          // /api/ttlock and /api/ttlock/code — webhook is carved out below
  // /api/ical/export es PUBLICO — Airbnb / Google Calendar / VRBO lo
  // consumen sin sesion. La autorizacion se hace via property.ical_token
  // dentro del endpoint (capability URL).
  "/api/ical/import",
  "/api/admin",           // panel de SaaS — el propio endpoint verifica MASTER_EMAIL
];

/**
 * Paths that start with a protected prefix but should stay public. These are
 * typically webhooks (called by third parties who don't have a user session)
 * or feeds that external calendars pull without auth.
 */
const PROTECTED_EXCEPTIONS = [
  "/api/ttlock/webhook",
];

/**
 * Dynamic public routes — any path that starts with one of these is public
 * regardless of the PROTECTED_PREFIXES list above.
 *
 *   - /api/ical/:propertyId  → iCal feed pulled by Airbnb/VRBO without auth
 *   - /api/checkin           → guest check-in flow (internal auth by lastName + last4)
 *   - /checkin/:bookingId    → guest-facing check-in page
 *   - /hub/:hostId           → shared public host portal
 */
function isDynamicPublicPath(pathname: string): boolean {
  // /api/ical/* es PUBLICO excepto /api/ical/import (que necesita sesion del
  // host para importar a su tenant). Tanto /api/ical/[propertyId] como
  // /api/ical/export son consumidos por Airbnb/VRBO/Google Calendar sin
  // sesion — usan auth via token o admin client.
  if (pathname.startsWith("/api/ical/") && !pathname.startsWith("/api/ical/import")) {
    return true;
  }
  if (pathname === "/api/checkin" || pathname.startsWith("/api/checkin/")) return true;
  if (pathname.startsWith("/checkin/")) return true;
  if (pathname.startsWith("/hub/")) return true;
  return false;
}

function isProtectedPath(pathname: string): boolean {
  if (PROTECTED_EXCEPTIONS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return false;
  }
  if (isDynamicPublicPath(pathname)) return false;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ── Middleware ──────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  // Backwards-compat: el simulador viejo vivía en /dashboard?view=staff.
  // Lo matamos en 2026-05-01, pero seguimos respetando WhatsApps que ya
  // están en celulares de limpiadoras: redirigimos al app real /staff.
  if (
    req.nextUrl.pathname === "/dashboard" &&
    req.nextUrl.searchParams.get("view") === "staff"
  ) {
    const target = req.nextUrl.clone();
    target.pathname = "/staff";
    target.searchParams.delete("view");
    return NextResponse.redirect(target);
  }

  const res = NextResponse.next();
  const supabase = createSupabaseMiddlewareClient(req, res);

  // IMPORTANT: `getUser()` revalidates the session with Supabase and also
  // refreshes the cookie. Do not replace this with `getSession()` — that one
  // only reads the cookie and can be spoofed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  if (isProtectedPath(pathname) && !user) {
    // API routes → machine-readable 401.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NO_SESSION" },
        { status: 401 }
      );
    }
    // Page routes → redirect to login, preserving la URL completa
    // (path + query) en `next` para que después del login retomemos el
    // destino exacto. Antes solo preservábamos el pathname y se perdía
    // el `?task=XXX` de los links del WhatsApp.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/acceso";
    loginUrl.search = ""; // limpiar query del request original
    const fullDestination = pathname + (req.nextUrl.search || "");
    loginUrl.searchParams.set("next", fullDestination);
    const redir = NextResponse.redirect(loginUrl);
    redir.headers.set("Cache-Control", "no-store, max-age=0");
    return redir;
  }

  // En rutas protegidas servidas con sesion valida, marcamos no-store para
  // que el browser no guarde la pagina en cache. Sin esto, despues de un
  // logout el navegador puede mostrar el dashboard cacheado por un instante
  // antes de que el redirect tome efecto.
  if (isProtectedPath(pathname)) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
  }

  return res;
}

// ── Matcher ─────────────────────────────────────────────────────────────────
// Run on everything except static assets, _next internals, and favicon.
// (The function itself then decides protected vs public per-path.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
