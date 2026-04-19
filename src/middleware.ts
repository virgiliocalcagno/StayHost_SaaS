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
  "/api/tuya",
  "/api/ttlock",          // /api/ttlock and /api/ttlock/code — webhook is carved out below
  "/api/ical/export",
  "/api/ical/import",
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
  // /api/ical/[propertyId] but NOT /api/ical/export or /api/ical/import
  if (pathname.startsWith("/api/ical/") &&
      !pathname.startsWith("/api/ical/export") &&
      !pathname.startsWith("/api/ical/import")) {
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
    // Page routes → redirect to login, preserving the intended destination.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/acceso";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

// ── Matcher ─────────────────────────────────────────────────────────────────
// Run on everything except static assets, _next internals, and favicon.
// (The function itself then decides protected vs public per-path.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
