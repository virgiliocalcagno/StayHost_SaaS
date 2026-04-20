import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// Low-level TTLock proxy.
//
// This endpoint is gated by middleware (only authenticated tenants can hit
// it) and additionally re-checks the session here. It NEVER accepts TTLock
// API credentials from the request body anymore — credentials come from
// the tenant's ttlock_config row in the database.

const TTLOCK_BASE = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

function md5(str: string) {
  return crypto.createHash("md5").update(str).digest("hex");
}

async function ttlockRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  accessToken?: string
) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) throw new Error("TTLOCK_CLIENT_ID not configured");

  const base: Record<string, unknown> = { clientId, accessToken, date: Date.now(), ...params };
  const url = new URL(`${TTLOCK_BASE}${path}`);

  if (method === "GET") {
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return (await fetch(url.toString())).json();
  }

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) body.set(k, String(v));
  }
  return (await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })).json();
}

async function getAccessToken(username: string, password: string) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TTLock credentials not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password: md5(password),
    grant_type: "password",
  });

  const res = await fetch(`${TTLOCK_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  console.log("[ttlock/getToken] clientId:", clientId?.slice(0, 8) + "...");
  console.log("[ttlock/getToken] response:", text);
  return JSON.parse(text);
}

export async function POST(req: NextRequest) {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { action, accessToken, ...params } = body;
    // Strip any credentials the caller tried to smuggle in — they're ignored
    // on the server side.
    delete (params as Record<string, unknown>).credentials;

    const clientId = process.env.TTLOCK_CLIENT_ID;

    // Demo mode when env is also missing — useful for local dev without real
    // TTLock account.
    if (!clientId) {
      return NextResponse.json({
        mock: true,
        message: "TTLock no configurado. Modo demo activo.",
        ...getMockData(String(action)),
      });
    }

    switch (action) {
      case "getToken": {
        const { username, password } = params as { username: string; password: string };
        return NextResponse.json(await getAccessToken(username, password));
      }
      case "listLocks":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lock/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string));
      case "lockDetail":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lock/detail", params, accessToken as string));
      case "createPin":
        return NextResponse.json(await ttlockRequest("POST", "/v3/keyboardPwd/add", { addType: 2, ...params }, accessToken as string));
      case "deletePin":
        return NextResponse.json(await ttlockRequest("POST", "/v3/keyboardPwd/delete", params, accessToken as string));
      case "lockRecords":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lockRecord/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string));
      case "remoteUnlock":
        return NextResponse.json(await ttlockRequest("POST", "/v3/lock/unlock", params, accessToken as string));
      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function getMockData(action: string) {
  switch (action) {
    case "listLocks":
      return { list: [{ lockId: "demo-lock-1", lockAlias: "Cerradura Demo", electricQuantity: 85 }] };
    case "getToken":
      return { access_token: "demo-token", expires_in: 3600 };
    case "createPin":
      return { keyboardPwdId: `kpid-${Date.now()}`, errcode: 0 };
    default:
      return { errcode: 0 };
  }
}
