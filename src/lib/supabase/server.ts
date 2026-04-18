import { createClient } from "@supabase/supabase-js";

// Lazy initialization — only created when first called, not at build time
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    _client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return _client;
}

// Backwards-compatible alias
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    return getSupabaseAdmin()[prop as keyof ReturnType<typeof createClient>];
  },
});
