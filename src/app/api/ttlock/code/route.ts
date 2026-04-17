import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

async function getTTLockToken(tenantId: string): Promise<string | null> {
  const { data: config } = await supabaseAdmin
    .from("ttlock_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();

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
  const json = await res.json();

  // Persist new token
  await supabaseAdmin.from("ttlock_config").update({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    token_expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  }).eq("tenant_id", tenantId);

  return json.access_token;
}

// POST /api/ttlock/code
// Body: { tenantId, lockId, checkIn, checkOut, guestName }
// Returns: { code: string, startDate: number, endDate: number }
export async function POST(req: NextRequest) {
  try {
    const { tenantId, lockId, checkIn, checkOut, guestName } = await req.json();

    if (!tenantId || !lockId || !checkIn || !checkOut) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await getTTLockToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: "TTLock not configured or auth failed" }, { status: 503 });
    }

    // Convert dates to timestamps (ms) — TTLock expects ms
    const startDate = new Date(checkIn).setHours(14, 0, 0, 0);   // 2pm check-in
    const endDate = new Date(checkOut).setHours(12, 0, 0, 0);    // 12pm check-out

    const params = new URLSearchParams({
      clientId: process.env.TTLOCK_CLIENT_ID!,
      accessToken: token,
      lockId: String(lockId),
      keyboardPwdType: "3",          // 3 = custom periodic PIN
      keyboardPwdName: `StayHost - ${guestName}`,
      startDate: String(startDate),
      endDate: String(endDate),
      date: String(Date.now()),
    });

    const res = await fetch(`${TTLOCK_API}/v3/keyboardPwd/get?${params}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const json = await res.json();

    if (json.errcode !== 0) {
      console.error("[ttlock/code] API error:", json);
      return NextResponse.json({ error: json.errmsg ?? "TTLock API error" }, { status: 502 });
    }

    return NextResponse.json({
      code: json.keyboardPwd,
      startDate,
      endDate,
    });
  } catch (err) {
    console.error("[ttlock/code]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
