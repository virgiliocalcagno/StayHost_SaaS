import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

type TTLockConfig = {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  username: string;
  password: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

// Uses the admin client only to read the ttlock_config row (service role
// needs to read client_secret regardless of RLS). We still validate that the
// tenantId comes from the authenticated session — callers cannot read other
// tenants' locks.
async function getTTLockToken(tenantId: string): Promise<string | null> {
  const { data: config } = await supabaseAdmin
    .from("ttlock_config")
    .select("tenant_id, client_id, client_secret, username, password, access_token, refresh_token, token_expires_at")
    .eq("tenant_id", tenantId)
    .single<TTLockConfig>();

  if (!config) return null;

  // Reuse token if still valid (5 min buffer)
  if (config.access_token && config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return config.access_token;
  }

  // Request new token
  const body = new URLSearchParams({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    username: config.username,
    password: config.password ?? "",
    grant_type: "password",
  });

  const res = await fetch(`${TTLOCK_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) return null;
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token) return null;

  // Persist new token
  await supabaseAdmin
    .from("ttlock_config")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      token_expires_at: new Date(Date.now() + (json.expires_in ?? 0) * 1000).toISOString(),
    } as never)
    .eq("tenant_id", tenantId);

  return json.access_token;
}

// Generate a random 6-digit PIN — TTLock accepts 4-9 digits for keyboardPwd
function randomPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/ttlock/code
// Body: { lockId, checkIn, checkOut, guestName }
// Tenant comes from the session.
// Returns: { code, startDate, endDate }
//
// FIX: previous version called `/v3/keyboardPwd/get` which asks the cloud to
// generate a PIN and only works for certain lock types. Switched to
// `/v3/keyboardPwd/add` which works for any period PIN via gateway.
export async function POST(req: NextRequest) {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const { lockId, checkIn, checkOut, guestName } = await req.json();

    if (!lockId || !checkIn || !checkOut) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await getTTLockToken(tenantId);
    if (!token) {
      return NextResponse.json(
        { error: "TTLock not configured or auth failed" },
        { status: 503 }
      );
    }

    const clientId = process.env.TTLOCK_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "TTLOCK_CLIENT_ID not configured" }, { status: 503 });
    }

    // Convert dates to timestamps (ms) — TTLock expects ms
    const startDate = new Date(checkIn).setHours(14, 0, 0, 0); // 2pm check-in
    const endDate = new Date(checkOut).setHours(12, 0, 0, 0); // 12pm check-out

    const code = randomPin();

    const params = new URLSearchParams({
      clientId,
      accessToken: token,
      lockId: String(lockId),
      keyboardPwd: code,
      keyboardPwdName: `StayHost - ${guestName ?? "Huésped"}`,
      startDate: String(startDate),
      endDate: String(endDate),
      addType: "2", // 2 = via gateway (remote)
      date: String(Date.now()),
    });

    const res = await fetch(`${TTLOCK_API}/v3/keyboardPwd/add`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const json = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      keyboardPwdId?: number;
    };

    if (json.errcode !== 0) {
      console.error("[ttlock/code] API error:", json);
      return NextResponse.json(
        { error: json.errmsg ?? "TTLock API error", errcode: json.errcode },
        { status: 502 }
      );
    }

    return NextResponse.json({
      code,
      keyboardPwdId: json.keyboardPwdId ?? null,
      startDate,
      endDate,
    });
  } catch (err) {
    console.error("[ttlock/code]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
