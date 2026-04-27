/**
 * GET /api/gateways/debug — solo MASTER.
 *
 * Devuelve la respuesta cruda de TTLock para ambos endpoints:
 *   /v3/gateway/list                 → todos los gateways de la cuenta
 *   /v3/gateway/listByLock?lockId=X  → gateways de un lock especifico
 *
 * Para cada propiedad del tenant. Sirve para diagnosticar mismatch
 * entre lo que TTLock UI muestra y lo que nuestro endpoint /status
 * interpreta. Sin esto adivinamos a ciegas.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

type AccountRow = {
  id: string;
  tenant_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

async function oauthRefresh(refreshToken: string) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(`${TTLOCK_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
}

async function resolveAccessToken(accountId: string, tenantId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabaseAdmin.from("ttlock_accounts") as any)
    .select("id, tenant_id, access_token, refresh_token, token_expires_at")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const account = row as AccountRow | null;
  if (!account) return null;
  if (account.access_token && account.token_expires_at) {
    const expiresAt = new Date(account.token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return account.access_token;
  }
  if (!account.refresh_token) return null;
  const refreshed = await oauthRefresh(account.refresh_token);
  if (!refreshed?.access_token) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin.from("ttlock_accounts") as any)
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? account.refresh_token,
      token_expires_at: new Date(Date.now() + (refreshed.expires_in ?? 7_776_000) * 1000).toISOString(),
    })
    .eq("id", accountId);
  return refreshed.access_token;
}

export async function GET() {
  // Master gate
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = (user.email ?? "").trim().toLowerCase();
  if (email !== MASTER_EMAIL) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Tenant del master
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tu } = await (supabaseAdmin.from("tenant_users") as any)
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const tenantId = (tu as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: props } = await (supabaseAdmin.from("properties") as any)
    .select("id, name, ttlock_account_id, ttlock_lock_id")
    .eq("tenant_id", tenantId)
    .not("ttlock_lock_id", "is", null);
  const properties = (props ?? []) as Array<{
    id: string; name: string;
    ttlock_account_id: string | null;
    ttlock_lock_id: string | null;
  }>;

  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "TTLOCK_CLIENT_ID not set" }, { status: 500 });

  // Resolver access token (asumimos 1 cuenta para simplicidad debug)
  const accountId = properties.find((p) => p.ttlock_account_id)?.ttlock_account_id;
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 400 });
  const accessToken = await resolveAccessToken(accountId, tenantId);
  if (!accessToken) return NextResponse.json({ error: "No access token" }, { status: 500 });

  // 1) /v3/gateway/list raw
  const listParams = new URLSearchParams({
    clientId,
    accessToken,
    pageNo: "1",
    pageSize: "100",
    date: String(Date.now()),
  });
  const listRes = await fetch(`${TTLOCK_API}/v3/gateway/list`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: listParams.toString(),
  });
  const listJson = await listRes.json();

  // 2) /v3/gateway/listByLock raw, por cada propiedad
  const byLock: Array<{ propertyName: string; lockId: string; rawResponse: unknown }> = [];
  for (const prop of properties) {
    if (!prop.ttlock_lock_id) continue;
    const params = new URLSearchParams({
      clientId,
      accessToken,
      lockId: String(prop.ttlock_lock_id),
      date: String(Date.now()),
    });
    try {
      const res = await fetch(`${TTLOCK_API}/v3/gateway/listByLock`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const json = await res.json();
      byLock.push({
        propertyName: prop.name,
        lockId: String(prop.ttlock_lock_id),
        rawResponse: json,
      });
    } catch (err) {
      byLock.push({
        propertyName: prop.name,
        lockId: String(prop.ttlock_lock_id),
        rawResponse: { error: String(err) },
      });
    }
  }

  return NextResponse.json({
    listAll: listJson,
    listByLock: byLock,
  });
}
