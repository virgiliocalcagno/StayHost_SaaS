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
async function getTTLockConfig(tenantId: string): Promise<{ token: string; clientId: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types yet
  const { data: config } = await (supabaseAdmin.from("ttlock_config") as any)
    .select("tenant_id, client_id, client_secret, username, password, access_token, refresh_token, token_expires_at")
    .eq("tenant_id", tenantId)
    .single();

  if (!config) return null;
  const cfg = config as TTLockConfig;

  // Reuse token if still valid (5 min buffer)
  if (cfg.access_token && cfg.token_expires_at) {
    const expiresAt = new Date(cfg.token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      return { token: cfg.access_token, clientId: cfg.client_id };
    }
  }

  // Request new token
  const body = new URLSearchParams({
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    username: cfg.username,
    password: cfg.password ?? "",
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types yet
  await (supabaseAdmin.from("ttlock_config") as any)
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      token_expires_at: new Date(Date.now() + (json.expires_in ?? 0) * 1000).toISOString(),
    })
    .eq("tenant_id", tenantId);

  return { token: json.access_token, clientId: cfg.client_id };
}

// Generate a random 6-digit PIN — TTLock accepts 4-9 digits for keyboardPwd
function randomPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/ttlock/code
// Body: { lockId, checkIn, checkOut, guestName }
// Tenant comes from the session.
// Returns: { code, keyboardPwdId, startDate, endDate }
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

    const cfg = await getTTLockConfig(tenantId);
    if (!cfg) {
      return NextResponse.json(
        { error: "TTLock not configured or auth failed" },
        { status: 503 }
      );
    }

    const { token, clientId } = cfg;

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
