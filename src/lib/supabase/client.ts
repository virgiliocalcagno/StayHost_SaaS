"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Uses `@supabase/ssr`'s browser client instead of the plain `supabase-js`
 * one so that the auth session is stored in cookies that the server-side
 * middleware and route handlers can also read. Without this, the login
 * would "work" in the browser but the server would see no session.
 *
 * Singleton — re-used across the app to avoid spawning a new client on
 * every import.
 */

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "Supabase browser client not configured: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    }
    _client = createBrowserClient(url, anonKey);
  }
  return _client;
}

// Named export for ergonomic imports.
// Replaces the old `supabase` singleton that used `createClient` directly.
export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_, prop) {
    return getSupabaseBrowserClient()[prop as keyof ReturnType<typeof createBrowserClient>];
  },
});
