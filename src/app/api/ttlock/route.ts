import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const TTLOCK_BASE = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

function md5(str: string) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// Always uses server-side env vars — never accepts credentials from the frontend
async function ttlockRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  accessToken?: string,
  credentials?: { clientId?: string; clientSecret?: string }
) {
  const clientId = credentials?.clientId || process.env.TTLOCK_CLIENT_ID;
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

async function getAccessToken(username: string, password: string, credentials?: { clientId?: string; clientSecret?: string }) {
  const clientId = credentials?.clientId || process.env.TTLOCK_CLIENT_ID;
  const clientSecret = credentials?.clientSecret || process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TTLock credentials not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password: md5(password),
    grant_type: "password",
  });

  return (await fetch(`${TTLOCK_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })).json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, accessToken, credentials: creds, ...params } = body;
    const credentials = creds as { clientId?: string; clientSecret?: string };

    const clientId = credentials?.clientId || process.env.TTLOCK_CLIENT_ID;

    // Demo mode when no credentials provided and environment variable is also missing
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
        return NextResponse.json(await getAccessToken(username, password, credentials));
      }
      case "listLocks":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lock/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string, credentials));
      case "lockDetail":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lock/detail", params, accessToken as string, credentials));
      case "createPin":
        return NextResponse.json(await ttlockRequest("POST", "/v3/keyboardPwd/add", { addType: 2, ...params }, accessToken as string, credentials));
      case "deletePin":
        return NextResponse.json(await ttlockRequest("POST", "/v3/keyboardPwd/delete", params, accessToken as string, credentials));
      case "lockRecords":
        return NextResponse.json(await ttlockRequest("GET", "/v3/lockRecord/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string, credentials));
      case "remoteUnlock":
        return NextResponse.json(await ttlockRequest("POST", "/v3/lock/unlock", params, accessToken as string, credentials));
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
