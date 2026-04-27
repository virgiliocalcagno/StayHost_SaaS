/**
 * TTLock — estado de gateways.
 *
 * Un gateway TTLock es el puente WiFi entre la cerradura (Bluetooth) e
 * internet. Sin gateway online, StayHost no puede mandar PINs nuevos a
 * la cerradura — los PINs ya cargados siguen funcionando, pero los
 * cambios quedan pendientes hasta que vuelva la conexion.
 *
 * Caso real preocupante: zonas donde se va el internet o la luz, el
 * gateway queda offline y un huesped que llega ese dia con un PIN nuevo
 * (que aun no se sincronizo) no puede entrar.
 *
 * Este helper consulta TTLock cada vez que el dashboard lo pide; la
 * latencia es ~1-2s (oauth + listGateway) — tolerable porque es opt-in
 * (cliente refresca o cron lo dispara). Si necesitamos cachearlo, lo
 * hacemos en otra capa.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const TTLOCK_REQUEST_TIMEOUT_MS = 6000;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type AccountRow = {
  id: string;
  tenant_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type TTLockGatewayEntry = {
  gatewayId: number | string;
  gatewayName?: string;
  networkName?: string;
  gatewayMac?: string;
  signal?: number;
  isOnline?: number; // 0 = offline, 1 = online
  lockNum?: number;
};

export type GatewayStatus = {
  gatewayId: string;
  gatewayName: string;
  networkName: string | null;
  isOnline: boolean;
  signal: number | null;
  lockNum: number;
};

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTLOCK_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  const res = await fetchWithTimeout(`${TTLOCK_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) return null;
  return json;
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

/**
 * Lista todos los gateways de una cuenta TTLock con su estado online.
 * Pagina por 100 hasta agotar (defensivo: tope de 5 paginas).
 */
export async function listGatewaysForAccount(args: {
  accountId: string;
  tenantId: string;
}): Promise<GatewayStatus[]> {
  const { accountId, tenantId } = args;
  const accessToken = await resolveAccessToken(accountId, tenantId);
  if (!accessToken) return [];
  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return [];

  const all: TTLockGatewayEntry[] = [];
  let pageNo = 1;
  const pageSize = 100;
  for (let i = 0; i < 5; i++) {
    const params = new URLSearchParams({
      clientId,
      accessToken,
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      date: String(Date.now()),
    });
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/gateway/list`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      list?: TTLockGatewayEntry[];
    };
    if (json.errcode && json.errcode !== 0) {
      console.warn(`[ttlock/gateway] list error: ${json.errcode} ${json.errmsg ?? ""}`);
      break;
    }
    const list = json.list ?? [];
    all.push(...list);
    if (list.length < pageSize) break;
    pageNo += 1;
  }

  return all.map((g) => ({
    gatewayId: String(g.gatewayId),
    gatewayName: g.gatewayName ?? "Gateway",
    networkName: g.networkName ?? null,
    isOnline: g.isOnline === 1,
    signal: typeof g.signal === "number" ? g.signal : null,
    lockNum: typeof g.lockNum === "number" ? g.lockNum : 0,
  }));
}

/**
 * Devuelve el gatewayId asociado a un lock + el rssi (signal especifico
 * de ese lock, distinto al signal global del gateway). NO incluye
 * isOnline porque /v3/gateway/listByLock NO lo devuelve — para saber si
 * el gateway esta online hay que cruzar con listGatewaysForAccount por
 * gatewayId.
 *
 * Devuelve null si el lock no esta vinculado a ningun gateway en TTLock
 * (caso real: cerradura conectada fisicamente pero la asociacion no se
 * registro en la app TTLock).
 */
export async function getLinkedGatewayId(args: {
  accountId: string;
  tenantId: string;
  lockId: string;
}): Promise<{ gatewayId: string; rssi: number | null } | null> {
  const { accountId, tenantId, lockId } = args;
  const accessToken = await resolveAccessToken(accountId, tenantId);
  if (!accessToken) return null;
  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return null;

  const params = new URLSearchParams({
    clientId,
    accessToken,
    lockId,
    date: String(Date.now()),
  });
  try {
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/gateway/listByLock`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      list?: Array<{
        gatewayId: number | string;
        gatewayName?: string;
        gatewayMac?: string;
        rssi?: number;
        rssiUpdateDate?: number;
      }>;
    };
    if (json.errcode && json.errcode !== 0) return null;
    const first = json.list?.[0];
    if (!first) return null;
    return {
      gatewayId: String(first.gatewayId),
      rssi: typeof first.rssi === "number" ? first.rssi : null,
    };
  } catch (err) {
    console.warn("[ttlock/gateway] listByLock error:", err);
    return null;
  }
}
