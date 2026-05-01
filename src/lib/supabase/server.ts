import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Server-side Supabase client that respects the current user's session.
 *
 * Use this from:
 *   - server components
 *   - server actions
 *   - route handlers that respond to authenticated user requests
 *
 * This client uses the anon key + the user's session cookie, so every query
 * is filtered by Row Level Security (RLS). Data leaks are impossible as long
 * as RLS policies are correct.
 *
 * Re-exported as `supabaseAdmin` from './admin' for the (shrinking) set of
 * call sites that legitimately need the service role key.
 */

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase server client not configured: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` can throw from Server Components; ignored — middleware
          // refreshes the cookie on the next request.
        }
      },
    },
  });
}

/**
 * Middleware variant — reads + writes cookies through the NextRequest /
 * NextResponse pair. Used by `src/middleware.ts` to refresh the session on
 * every navigation so the cookie doesn't expire mid-browsing.
 */
export function createSupabaseMiddlewareClient(
  req: NextRequest,
  res: NextResponse
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase middleware client not configured: missing env vars"
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
      ) {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set({ name, value, ...options });
        }
      },
    },
  });
}

/**
 * Resolve the tenant_id for the currently authenticated user.
 * Returns null if the user is not logged in or has no tenant linked.
 *
 * Lookup order:
 *   1. `tenants.user_id = auth.uid()` (owner case)
 *   2. `team_members.auth_user_id = auth.uid()` (staff case — limpiadoras,
 *      mantenimiento, co-host, etc. linkeados a un tenant ajeno)
 *
 * Mantener este orden importa: si una persona es OWNER de un tenant Y
 * además está como team_member en otro tenant, su lookup primario debe
 * ser el suyo propio. (Caso raro pero posible en el futuro con co-hosts).
 */
export async function getAuthenticatedTenant() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, tenantId: null, supabase };

  // 1. Owner lookup.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  let tenantId = (tenant as { id: string } | null)?.id ?? null;

  // 2. Staff lookup — solo si el usuario no es owner de ningún tenant.
  if (!tenantId) {
    const { data: member } = await supabase
      .from("team_members")
      .select("tenant_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    tenantId = (member as { tenant_id: string } | null)?.tenant_id ?? null;
  }

  return { user, tenantId, supabase };
}

// ─── Deprecated re-export ────────────────────────────────────────────────────
// `supabaseAdmin` used to live in this file. It now lives in './admin'. The
// re-export here keeps the 8 existing route handlers compiling while they are
// migrated to the session-aware client one by one.
//
// TODO(auth-migration): remove this export and point each importer to
// `@/lib/supabase/admin` (for webhooks/jobs) or
// `createSupabaseServerClient()` from this file (for user-facing routes).
export { supabaseAdmin, getSupabaseAdmin } from "./admin";
