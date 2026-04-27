/**
 * TTLock — PIN cíclico para staff (Acceso-2).
 *
 * Diferencia con sync-pin.ts (PIN por reserva):
 *   - Endpoint: /v3/keyboardPwdCyclic/add (no /v3/keyboardPwd/add)
 *   - Params: weekDays + startTime + endTime (en minutos desde medianoche)
 *     en lugar de startDate/endDate.
 *
 * Reusa el mismo patrón de oauth + retry + auto-heal del sync-pin existente.
 * Para mantener el path crítico de PINs por reserva intocado, esto vive en
 * un archivo separado y se invoca desde syncPinToLock cuando is_cyclic=true.
 *
 * Cuando llega un día atípico (ej: la limpiadora tiene que entrar a las 8pm
 * un sábado), generamos un PIN one-time aparte usando syncPinToLock con
 * un access_pins normal (booking_id=null, is_cyclic=false). Eso convive sin
 * tocar el cíclico.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deleteTTLockPin } from "./delete-pin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const MAX_ATTEMPTS = 6;
const TTLOCK_REQUEST_TIMEOUT_MS = 4000;
const BACKOFF_MS = [0, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];
const OFFLINE_LOCK_ERRCODES = new Set([-2009, -2012]);

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

export type CyclicConfig = {
  weekDays: number[];        // 1=Mon ... 7=Sun (ISO)
  startMin: number;          // minutos desde medianoche (0..1440)
  endMin: number;            // minutos desde medianoche (0..1440)
};

type CyclicPinRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  team_member_id: string | null;
  ttlock_lock_id: string | null;
  ttlock_pwd_id: string | null;
  guest_name: string;
  pin: string;
  status: string;
  sync_status: string;
  sync_attempts: number;
  is_cyclic: boolean;
  cyclic_config: CyclicConfig | null;
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

async function updateSyncState(pinId: string, patch: Record<string, unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin.from("access_pins") as any)
    .update({ ...patch, sync_last_attempt_at: new Date().toISOString() })
    .eq("id", pinId);
}

function scheduleRetry(attempts: number): string | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const delay = BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return new Date(Date.now() + delay).toISOString();
}

export type SyncCyclicPinResult =
  | { ok: true; ttlockPwdId: string }
  | { ok: false; reason: "not_found" | "no_lock" | "no_account" | "no_token" | "no_config" | "offline_lock" | "api_error" | "network_error"; detail?: string };

/**
 * Sincroniza un access_pin cíclico con TTLock. Análogo a syncPinToLock pero
 * llamando al endpoint cyclic. Mismo patrón de retry/backoff/auto-heal.
 */
export async function syncCyclicPinToLock(pinId: string): Promise<SyncCyclicPinResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow } = await (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, team_member_id, ttlock_lock_id, ttlock_pwd_id, guest_name, pin, status, sync_status, sync_attempts, is_cyclic, cyclic_config")
    .eq("id", pinId)
    .maybeSingle();
  const pin = pinRow as CyclicPinRow | null;
  if (!pin) return { ok: false, reason: "not_found" };
  if (pin.status !== "active") return { ok: false, reason: "not_found", detail: `pin.status=${pin.status}` };
  if (!pin.is_cyclic) return { ok: false, reason: "not_found", detail: "pin is not cyclic" };

  if (!pin.ttlock_lock_id) {
    await updateSyncState(pinId, { sync_status: "synced", sync_last_error: null });
    return { ok: false, reason: "no_lock" };
  }

  const config = pin.cyclic_config;
  if (!config || !Array.isArray(config.weekDays) || config.weekDays.length === 0) {
    await updateSyncState(pinId, {
      sync_status: "failed",
      sync_last_error: "cyclic_config inválido (faltan weekDays)",
    });
    return { ok: false, reason: "no_config" };
  }

  // Lock optimista contra carreras (igual que sync-pin.ts).
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: locked } = await (supabaseAdmin.from("access_pins") as any)
    .update({ sync_status: "syncing", sync_last_attempt_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", pinId)
    .or(`sync_status.in.(pending,retry,offline_lock),and(sync_status.eq.syncing,sync_last_attempt_at.lt.${staleCutoff}),and(sync_status.eq.syncing,sync_last_attempt_at.is.null)`);
  if (!locked) return { ok: false, reason: "not_found", detail: "already syncing or synced" };

  // Resolver accountId desde la propiedad
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prop } = await (supabaseAdmin.from("properties") as any)
    .select("ttlock_account_id")
    .eq("id", pin.property_id)
    .maybeSingle();
  const accountId = (prop as { ttlock_account_id?: string | null } | null)?.ttlock_account_id ?? null;
  if (!accountId) {
    await updateSyncState(pinId, {
      sync_status: "failed",
      sync_last_error: "La propiedad no tiene cuenta TTLock asignada",
    });
    return { ok: false, reason: "no_account" };
  }

  const accessToken = await resolveAccessToken(accountId, pin.tenant_id);
  if (!accessToken) {
    const nextAttempts = pin.sync_attempts + 1;
    const retryAt = scheduleRetry(nextAttempts);
    await updateSyncState(pinId, {
      sync_status: retryAt ? "retry" : "failed",
      sync_attempts: nextAttempts,
      sync_next_retry_at: retryAt,
      sync_last_error: "No se pudo obtener access token de TTLock",
    });
    return { ok: false, reason: "no_token" };
  }

  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) {
    await updateSyncState(pinId, {
      sync_status: "failed",
      sync_last_error: "TTLOCK_CLIENT_ID no configurado",
    });
    return { ok: false, reason: "no_token" };
  }

  // Borrar el PIN viejo si existe (best-effort).
  if (pin.ttlock_pwd_id) {
    try {
      const deletePromise = deleteTTLockPin({
        tenantId: pin.tenant_id,
        propertyId: pin.property_id,
        accountId,
        lockId: pin.ttlock_lock_id,
        keyboardPwdId: pin.ttlock_pwd_id,
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      await Promise.race([deletePromise, timeoutPromise]);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn("[ttlock/cyclic-pin] delete old pwd failed (continuing):", err);
    }
  }

  // Crear el PIN cíclico nuevo.
  // weekDays se manda como CSV: "1,2,3,4,5,6,7"
  // startTime/endTime: minutos desde medianoche (0..1440)
  const trazableName = `STAFF-${pin.guest_name.slice(0, 24)}`.slice(0, 32);
  const params = new URLSearchParams({
    clientId,
    accessToken,
    lockId: String(pin.ttlock_lock_id),
    keyboardPwd: pin.pin,
    keyboardPwdName: trazableName,
    weekDays: config.weekDays.join(","),
    startTime: String(config.startMin),
    endTime: String(config.endMin),
    addType: "2", // via gateway
    date: String(Date.now()),
  });

  try {
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/keyboardPwdCyclic/add`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string; keyboardPwdId?: number | string };

    if (json.errcode && json.errcode !== 0) {
      if (OFFLINE_LOCK_ERRCODES.has(json.errcode)) {
        await updateSyncState(pinId, {
          sync_status: "offline_lock",
          sync_next_retry_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          sync_last_error: `Cerradura offline: ${json.errmsg ?? json.errcode}`,
        });
        return { ok: false, reason: "offline_lock", detail: String(json.errmsg ?? json.errcode) };
      }
      const nextAttempts = pin.sync_attempts + 1;
      const retryAt = scheduleRetry(nextAttempts);
      await updateSyncState(pinId, {
        sync_status: retryAt ? "retry" : "failed",
        sync_attempts: nextAttempts,
        sync_next_retry_at: retryAt,
        sync_last_error: `TTLock error ${json.errcode}: ${json.errmsg ?? ""}`,
      });
      return { ok: false, reason: "api_error", detail: `${json.errcode}: ${json.errmsg ?? ""}` };
    }

    const newPwdId = json.keyboardPwdId != null ? String(json.keyboardPwdId) : "";
    await updateSyncState(pinId, {
      sync_status: "synced",
      sync_attempts: 0,
      sync_next_retry_at: null,
      sync_last_error: null,
      ttlock_pwd_id: newPwdId,
    });
    return { ok: true, ttlockPwdId: newPwdId };
  } catch (err) {
    const nextAttempts = pin.sync_attempts + 1;
    const retryAt = scheduleRetry(nextAttempts);
    const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
    const errMsg = isAbort
      ? `TTLock no respondió en ${TTLOCK_REQUEST_TIMEOUT_MS}ms (timeout)`
      : `Error de red: ${err instanceof Error ? err.message : String(err)}`;
    await updateSyncState(pinId, {
      sync_status: retryAt ? "retry" : "failed",
      sync_attempts: nextAttempts,
      sync_next_retry_at: retryAt,
      sync_last_error: errMsg,
    });
    return { ok: false, reason: "network_error", detail: errMsg };
  }
}

// Convierte "HH:MM" a minutos desde medianoche.
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

// Genera un PIN aleatorio de 6 dígitos. Evita 0 inicial (algunas cerraduras
// rechazan PINs que empiezan con 0).
export function generateStaffPin(): string {
  const first = 1 + Math.floor(Math.random() * 9);
  const rest = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `${first}${rest}`;
}
