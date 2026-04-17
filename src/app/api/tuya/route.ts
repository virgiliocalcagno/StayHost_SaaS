/**
 * Tuya Cloud API Proxy — /api/tuya
 * Runs server-side. Auth: HMAC-SHA256 signature.
 *
 * Tuya regions: cn, us, eu, in
 * Base URLs: https://openapi.tuyaeu.com (EU), https://openapi.tuyaus.com (US)
 *
 * POST body: { action, deviceId?, ...params }
 * Actions:
 *   "getToken"    → POST /v1.0/token (get access_token)
 *   "listDevices" → GET  /v1.0/users/{uid}/devices OR /v1.0/devices
 *   "getDevice"   → GET  /v1.0/devices/{deviceId}
 *   "getStatus"   → GET  /v1.0/devices/{deviceId}/status
 *   "sendCommand" → POST /v1.0/devices/{deviceId}/commands { commands: [{code, value}] }
 *   "getLogs"     → GET  /v1.0/devices/{deviceId}/logs
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const REGION_URLS: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuya.com",
  in: "https://openapi.tuyain.com",
};

function hmacSha256(str: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(str).digest("hex").toUpperCase();
}

function sha256(str: string) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function tuyaRequest(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  accessToken?: string,
  credentials?: { clientId?: string; clientSecret?: string; region?: string }
) {
  const clientId = credentials?.clientId || process.env.TUYA_CLIENT_ID;
  const clientSecret = credentials?.clientSecret || process.env.TUYA_CLIENT_SECRET;
  const region = credentials?.region || process.env.TUYA_REGION || "eu";

  if (!clientId || !clientSecret) {
    throw new Error("Credenciales de Tuya no configuradas (Client ID o Secret faltante)");
  }

  const baseUrl = REGION_URLS[region] || REGION_URLS.eu;
  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const contentHash = sha256(bodyStr);
  const stringToSign = [method, contentHash, "", path].join("\n");
  const signStr = clientId + (accessToken ?? "") + t + stringToSign;
  const sign = hmacSha256(signStr, clientSecret);

  const headers: Record<string, string> = {
    "client_id": clientId,
    "t": t,
    "sign": sign,
    "sign_method": "HMAC-SHA256",
    "Content-Type": "application/json",
  };
  if (accessToken) headers["access_token"] = accessToken;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json() as Record<string, unknown>;
    const { action, accessToken, deviceId, credentials: creds, ...params } = payload;
    const credentials = creds as { clientId?: string; clientSecret?: string; region?: string };

    const clientId = credentials?.clientId || process.env.TUYA_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ mock: true, message: "Tuya credentials not configured. Using demo mode.", data: getMockData(String(action), String(deviceId ?? "")) });
    }

    switch (action) {
      case "getToken": {
        const data = await tuyaRequest("GET", "/v1.0/token?grant_type=1", null, undefined, credentials);
        return NextResponse.json(data);
      }
      case "getAuthData": {
        const clientId = credentials?.clientId || process.env.TUYA_CLIENT_ID;
        const region = credentials?.region || process.env.TUYA_REGION || "eu";
        const redirectUri = params.redirectUri ?? "http://localhost:3000/dashboard";
        
        // Universal Authorization Portal H5
        const authUrl = `https://iot.tuya.com/cloud/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(String(redirectUri))}&response_type=code&region=${region}`;
        
        return NextResponse.json({ 
          success: true, 
          result: { 
            authUrl,
            qrUrl: `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(authUrl)}&size=300x300`
          } 
        });
      }
      case "listDevices": {
        const uid = params.uid ?? process.env.TUYA_UID;
        if (!uid) {
           // Fallback to project-level list if no UID
           const data = await tuyaRequest("GET", "/v1.0/iot-03/devices?page_size=50", null, String(accessToken), credentials);
           return NextResponse.json(data);
        }
        const data = await tuyaRequest("GET", `/v1.0/users/${uid}/devices`, null, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      case "listAllDevices": {
        const data = await tuyaRequest("GET", "/v1.0/iot-03/devices?page_size=50", null, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      case "getDevice": {
        const data = await tuyaRequest("GET", `/v1.0/devices/${deviceId}`, null, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      case "getStatus": {
        const data = await tuyaRequest("GET", `/v1.0/devices/${deviceId}/status`, null, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      case "sendCommand": {
        const data = await tuyaRequest("POST", `/v1.0/devices/${deviceId}/commands`, { commands: params.commands }, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      case "getLogs": {
        const data = await tuyaRequest("GET", `/v1.0/devices/${deviceId}/logs?type=7&size=20`, null, String(accessToken), credentials);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function getMockData(action: string, deviceId: string) {
  switch (action) {
    case "listDevices":
      return { result: [
        { id: "tuya-demo-1", name: "Termostato Villa", category: "wk", online: true, status: [{ code: "temp_current", value: 220 }, { code: "battery_percentage", value: 85 }] },
        { id: "tuya-demo-2", name: "Sensor Piscina", category: "wsdcg", online: true, status: [{ code: "va_temperature", value: 289 }, { code: "va_humidity", value: 65 }] },
      ]};
    case "getStatus":
      return { result: [{ code: "temp_current", value: 220 }, { code: "battery_percentage", value: 85 }] };
    case "sendCommand":
      return { result: true, success: true };
    default:
      return { result: true };
  }
}
