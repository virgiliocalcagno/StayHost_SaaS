/**
 * TTLock API Proxy — /api/ttlock
 * Runs server-side to hide client_id/client_secret.
 *
 * TTLock EU base URL: https://euapi.ttlock.com/v3/
 * Auth: POST /oauth2/token with client_id + username + password + MD5(password)
 *
 * POST body: { action, ...params }
 * Actions:
 *   "getToken"      → obtain access_token (store in localStorage on frontend)
 *   "listLocks"     → GET /v3/lock/list
 *   "lockDetail"    → GET /v3/lock/detail  { lockId }
 *   "createPin"     → POST /v3/keyboardPwd/add { lockId, keyboard_pwd, startDate, endDate, addType=2 }
 *   "deletePin"     → POST /v3/keyboardPwd/delete { lockId, keyboardPwdId }
 *   "lockRecords"   → GET /v3/lockRecord/list { lockId }
 *   "remoteUnlock"  → POST /v3/lock/unlock { lockId }
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const TTLOCK_BASE = "https://euapi.ttlock.com";

function md5(str: string) {
  return crypto.createHash("md5").update(str).digest("hex");
}

async function ttlockRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  accessToken?: string,
  dynamicCreds?: { clientId?: string; clientSecret?: string }
) {
  const clientId = dynamicCreds?.clientId || process.env.TTLOCK_CLIENT_ID;
  const clientSecret = dynamicCreds?.clientSecret || process.env.TTLOCK_CLIENT_SECRET;
  
  if (!clientId) throw new Error("TTLock Client ID not configured");

  const base: Record<string, unknown> = {
    clientId,
    accessToken,
    date: Date.now(),
    ...params,
  };

  const url = new URL(`${TTLOCK_BASE}${path}`);

  if (method === "GET") {
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString());
    return res.json();
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined) body.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return res.json();
  }
}

async function getAccessToken(username: string, password: string, dynamicCreds?: { clientId?: string; clientSecret?: string }) {
  const clientId = dynamicCreds?.clientId || process.env.TTLOCK_CLIENT_ID;
  const clientSecret = dynamicCreds?.clientSecret || process.env.TTLOCK_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) throw new Error("Missing TTLock credentials (Client ID or Secret)");

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
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, accessToken, credentials, ...params } = body;
    const dynamicCreds = credentials as { clientId?: string; clientSecret?: string } | undefined;

    // Use mock data ONLY if no dynamic credentials AND no ENV credentials
    const hasCreds = dynamicCreds?.clientId || process.env.TTLOCK_CLIENT_ID;
    
    if (!hasCreds) {
      return NextResponse.json({ mock: true, message: "TTLock credentials not configured. Using demo mode.", data: getMockData(String(action)) });
    }

    switch (action) {
      case "getToken": {
        const { username, password } = params as { username: string; password: string };
        const data = await getAccessToken(username, password, dynamicCreds);
        return NextResponse.json(data);
      }
      case "listLocks": {
        const data = await ttlockRequest("GET", "/v3/lock/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      case "lockDetail": {
        const data = await ttlockRequest("GET", "/v3/lock/detail", params, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      case "createPin": {
        const data = await ttlockRequest("POST", "/v3/keyboardPwd/add", { addType: 2, ...params }, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      case "deletePin": {
        const data = await ttlockRequest("POST", "/v3/keyboardPwd/delete", params, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      case "lockRecords": {
        const data = await ttlockRequest("GET", "/v3/lockRecord/list", { pageNo: 1, pageSize: 20, ...params }, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      case "remoteUnlock": {
        const data = await ttlockRequest("POST", "/v3/lock/unlock", params, accessToken as string | undefined, dynamicCreds);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Demo mode mock data
function getMockData(action: string) {
  switch (action) {
    case "listLocks":
      return { list: [{ lockId: "demo-lock-1", lockAlias: "Cerradura Villa Mar", electricQuantity: 85, lockName: "TTLock Demo" }] };
    case "createPin":
      return { keyboardPwdId: `kpid-${Date.now()}`, errcode: 0 };
    case "deletePin":
      return { errcode: 0 };
    default:
      return { errcode: 0 };
  }
}
