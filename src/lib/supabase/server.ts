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
 * This is the single place where the `auth.users.id → tenants.id` mapping
 * is resolved. Every route handler that needs a tenant_id should go through
 * here, not re-query itself.
 */
export async function getAuthenticatedTenant() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, tenantId: null, supabase };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("user_id", user.id)
    .single();

  return {
    user,
    tenantId: (tenant as { id: string } | null)?.id ?? null,
    supabase,
  };
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
