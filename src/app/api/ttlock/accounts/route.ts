/**
 * TTLock multi-account — /api/ttlock/accounts
 *
 * Replaces the single-row `ttlock_config` model. A tenant can now connect
 * N TTLock accounts (e.g. "Casa playa" and "Edificio centro"). We only ever
 * store tokens — the user's raw password is used once at connect time and
 * then discarded. Renewals use `refresh_token`; if that fails, the UI
 * prompts the tenant to re-enter their password.
 *
 * Actions (POST body `{ action, ... }`):
 *   connect    { label, username, password } → OAuth2, persist tokens
 *   reconnect  { accountId, password }       → same, for an existing row
 *   listLocks  { accountId }                 → TTLock /v3/lock/list
 *   rename     { accountId, label }          → update label
 *
 * Also:
 *   GET              → list tenant's accounts (no tokens exposed)
 *   DELETE ?id=...   → remove an account
 */
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

function md5(str: string) {
  return crypto.createHash("md5").update(str).digest("hex");
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  errcode?: number;
  errmsg?: string;
};

// Ask TTLock for a fresh pair of tokens using the password grant.
// TTLock expects the password to be md5-hashed (32-char lowercase hex).
async function oauthPassword(username: string, password: string): Promise<TokenResponse> {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { error: "server_misconfigured", error_description: "TTLOCK_CLIENT_ID/SECRET not set" };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password: md5(password),
    grant_type: "password",
  });

  const res = await fetch(`${TTLOCK_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return (await res.json()) as TokenResponse;
}

// Renew using the refresh token grant. Returns null if the refresh token is
// no longer valid (tenant must re-enter password).
async function oauthRefresh(refreshToken: string): Promise<TokenResponse | null> {
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
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) return null;
  return json;
}

type AccountRow = {
  id: string;
  tenant_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

// Return a usable access_token for the given account, renewing if needed.
// Uses supabaseAdmin to read the stored refresh_token because we need
// service-role access to decrypted columns regardless of RLS (we still
// validate that accountId belongs to tenantId first).
async function getAccessToken(accountId: string, tenantId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("ttlock_accounts")
    .select("id, tenant_id, access_token, refresh_token, token_expires_at")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle<AccountRow>();

  if (!row) return null;

  // Reuse current token if it's still valid (5 min buffer).
  if (row.access_token && row.token_expires_at) {
    const expiresAt = new Date(row.token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return row.access_token;
  }

  if (!row.refresh_token) return null;
  const refreshed = await oauthRefresh(row.refresh_token);
  if (!refreshed?.access_token) return null;

  await supabaseAdmin
    .from("ttlock_accounts")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? row.refresh_token,
      token_expires_at: new Date(
        Date.now() + (refreshed.expires_in ?? 7776000) * 1000
      ).toISOString(),
    } as never)
    .eq("id", accountId);

  return refreshed.access_token;
}

// GET — list tenant's accounts without exposing any tokens.
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("ttlock_accounts")
    .select("id, label, ttlock_username, token_expires_at, last_synced_at, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Flag accounts whose token already expired so the UI can prompt reconnect.
  const now = Date.now();
  const accounts = (data ?? []).map((a) => {
    const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : 0;
    return { ...a, expired: exp <= now };
  });

  return NextResponse.json({ accounts });
}

// DELETE ?id=...
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("ttlock_accounts")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// POST — action dispatcher.
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  switch (action) {
    case "connect": {
      const label = String(body.label ?? "").trim();
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!label || !username || !password) {
        return NextResponse.json(
          { error: "label, username y password son requeridos" },
          { status: 400 }
        );
      }

      const tok = await oauthPassword(username, password);
      if (!tok.access_token) {
        return NextResponse.json(
          {
            error: tok.error_description ?? tok.errmsg ?? tok.error ?? "Login TTLock falló",
            errcode: tok.errcode ?? null,
          },
          { status: 401 }
        );
      }

      const expiresAt = new Date(Date.now() + (tok.expires_in ?? 7776000) * 1000).toISOString();

      // Upsert on (tenant_id, username) — if the tenant already connected
      // this account, we refresh its tokens and label instead of erroring.
      const { data, error } = await supabase
        .from("ttlock_accounts")
        .upsert(
          {
            tenant_id: tenantId,
            label,
            ttlock_username: username,
            access_token: tok.access_token,
            refresh_token: tok.refresh_token ?? null,
            token_expires_at: expiresAt,
          } as never,
          { onConflict: "tenant_id,ttlock_username" }
        )
        .select("id, label, ttlock_username, token_expires_at")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, account: data });
    }

    case "reconnect": {
      const accountId = String(body.accountId ?? "");
      const password = String(body.password ?? "");
      if (!accountId || !password) {
        return NextResponse.json({ error: "accountId y password requeridos" }, { status: 400 });
      }

      // Read the row (RLS already scopes to tenant) to get the username.
      const { data: acc } = await supabase
        .from("ttlock_accounts")
        .select("id, ttlock_username")
        .eq("id", accountId)
        .maybeSingle<{ id: string; ttlock_username: string }>();
      if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const tok = await oauthPassword(acc.ttlock_username, password);
      if (!tok.access_token) {
        return NextResponse.json(
          { error: tok.error_description ?? tok.errmsg ?? "Login TTLock falló" },
          { status: 401 }
        );
      }

      const expiresAt = new Date(Date.now() + (tok.expires_in ?? 7776000) * 1000).toISOString();
      const { error } = await supabase
        .from("ttlock_accounts")
        .update({
          access_token: tok.access_token,
          refresh_token: tok.refresh_token ?? null,
          token_expires_at: expiresAt,
        } as never)
        .eq("id", accountId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "rename": {
      const accountId = String(body.accountId ?? "");
      const label = String(body.label ?? "").trim();
      if (!accountId || !label) {
        return NextResponse.json({ error: "accountId y label requeridos" }, { status: 400 });
      }
      const { error } = await supabase
        .from("ttlock_accounts")
        .update({ label } as never)
        .eq("id", accountId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "listLocks": {
      const accountId = String(body.accountId ?? "");
      if (!accountId) {
        return NextResponse.json({ error: "accountId requerido" }, { status: 400 });
      }
      const accessToken = await getAccessToken(accountId, tenantId);
      if (!accessToken) {
        return NextResponse.json(
          { error: "TOKEN_EXPIRED", message: "Reconecta esta cuenta con tu contraseña" },
          { status: 401 }
        );
      }
      const clientId = process.env.TTLOCK_CLIENT_ID;
      const url = new URL(`${TTLOCK_API}/v3/lock/list`);
      url.searchParams.set("clientId", clientId!);
      url.searchParams.set("accessToken", accessToken);
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("date", String(Date.now()));

      const res = await fetch(url.toString());
      const json = (await res.json()) as {
        list?: Array<{ lockId: number; lockAlias?: string; lockName?: string; electricQuantity?: number }>;
        errcode?: number;
        errmsg?: string;
      };

      if (json.errcode && json.errcode !== 0) {
        return NextResponse.json(
          { error: json.errmsg ?? "TTLock API error", errcode: json.errcode },
          { status: 502 }
        );
      }

      // Update last_synced_at for the account.
      await supabaseAdmin
        .from("ttlock_accounts")
        .update({ last_synced_at: new Date().toISOString() } as never)
        .eq("id", accountId);

      const locks = (json.list ?? []).map((l) => ({
        lockId: String(l.lockId),
        name: l.lockAlias ?? l.lockName ?? `Lock ${l.lockId}`,
        battery: l.electricQuantity ?? null,
      }));
      return NextResponse.json({ locks });
    }

    default:
      return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  }
}
