import { createClient } from "@supabase/supabase-js";

/**
 * Admin client — uses the service role key and BYPASSES Row Level Security.
 *
 * ⚠️  NEVER import this from:
 *   - client components ("use client")
 *   - route handlers that respond to user-facing requests
 *
 * ✅ Only safe to use from:
 *   - webhooks (TTLock, Stripe, etc.) where the caller is a trusted external system
 *   - background jobs / cron (iCal sync)
 *   - scripts in /scripts
 *   - one-off internal utilities
 *
 * For user-facing requests, use `createSupabaseServerClient` from './server'
 * which respects RLS via the user's session cookie.
 */

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        "Supabase admin client not configured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      );
    }
    _client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return _client;
}

// Backwards-compatible alias — same proxy pattern as before.
// TODO: remove once all call sites use getSupabaseAdmin() explicitly.
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    return getSupabaseAdmin()[prop as keyof ReturnType<typeof createClient>];
  },
});
