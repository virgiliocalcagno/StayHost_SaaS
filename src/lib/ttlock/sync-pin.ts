/**
 * TTLock — auto-sync de access_pins a la cerradura fisica.
 *
 * Patron: delete viejo + add nuevo. TTLock no tiene "editar PIN" — el que
 * intentaba reutilizar el keyboardPwdId viejo recibia errcode != 0
 * ("failed" que el host veia en el panel).
 *
 * Safe concurrency: antes de llamar a TTLock, marcamos la fila como
 * 'syncing'. Si el worker corre dos veces para el mismo pin (cron + trigger
 * al editar), solo uno agarra el lock.
 *
 * Backoff exponencial en fallos transitorios:
 *   intento 1 → inmediato
 *   intento 2 → +2min
 *   intento 3 → +5min
 *   intento 4 → +15min
 *   intento 5 → +1h
 *   intento 6 → +4h → tras este, failed.
 *
 * Offline lock: si TTLock responde codigo "lock offline", no contamos como
 * intento fallido; agendamos recheck a 10min.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deleteTTLockPin } from "./delete-pin";
import { reconcileTTLockPin, isTTLockAlreadyExistsError, buildPinTrazableName } from "./reconcile-pin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const MAX_ATTEMPTS = 6;

// Timeout por request a TTLock. Hobby plan de Vercel mata la function a los
// 10s — con 3 fetches (oauth + delete + add) necesitamos que cada uno termine
// rapido para que syncPinToLock no se cuelgue y deje la fila en 'syncing'.
const TTLOCK_REQUEST_TIMEOUT_MS = 4000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTLOCK_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Backoff en milisegundos indexado por numero de intentos previos.
const BACKOFF_MS = [0, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

// TTLock devuelve codigos conocidos. No hay lista publica exhaustiva, pero
// estos son los que vemos en la practica:
const OFFLINE_LOCK_ERRCODES = new Set([-2009, -2012]); // "lock offline" / "gateway offline"

type AccessPinRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  booking_id: string | null;
  ttlock_lock_id: string | null;
  ttlock_pwd_id: string | null;
  guest_name: string;
  pin: string;
  status: string;
  valid_from: string;
  valid_to: string;
  sync_status: string;
  sync_attempts: number;
};

type AccountRow = {
  id: string;
  tenant_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

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

export type SyncPinResult =
  | { ok: true; ttlockPwdId: string }
  | { ok: false; reason: "not_found" | "no_lock" | "no_account" | "no_token" | "offline_lock" | "api_error" | "network_error"; detail?: string };

async function updateSyncState(
  pinId: string,
  patch: Record<string, unknown>,
): Promise<void> {
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

/**
 * Sincroniza un access_pin con TTLock. Lee la fila, borra el pwd viejo si
 * hay, crea el nuevo, actualiza la fila con el nuevo `ttlock_pwd_id` y
 * `sync_status='synced'`. Nunca tira — siempre devuelve SyncPinResult y
 * deja la fila en un estado consistente (retry / failed / synced).
 */
export async function syncPinToLock(pinId: string): Promise<SyncPinResult> {
  // 1) Cargar el pin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow } = await (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, booking_id, ttlock_lock_id, ttlock_pwd_id, guest_name, pin, status, valid_from, valid_to, sync_status, sync_attempts")
    .eq("id", pinId)
    .maybeSingle();
  const pin = pinRow as AccessPinRow | null;
  if (!pin) return { ok: false, reason: "not_found" };

  // Si esta cancelado/revocado, no lo creamos en la cerradura.
  if (pin.status !== "active") {
    return { ok: false, reason: "not_found", detail: `pin.status=${pin.status}` };
  }

  if (!pin.ttlock_lock_id) {
    await updateSyncState(pinId, {
      sync_status: "synced", // sin cerradura → no hay nada que sincronizar
      sync_last_error: null,
    });
    return { ok: false, reason: "no_lock" };
  }

  // 2) Marcar 'syncing' (lock optimista). Aceptamos tambien recuperar
  //    filas stuck en 'syncing' por mas de 2 min — Vercel puede matar un
  //    fire-and-forget a mitad de camino y dejar la fila trabada. Sin este
  //    recovery, el PIN queda en 'syncing' para siempre y nadie lo retoma.
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: locked } = await (supabaseAdmin.from("access_pins") as any)
    .update({ sync_status: "syncing", sync_last_attempt_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", pinId)
    .or(`sync_status.in.(pending,retry,offline_lock),and(sync_status.eq.syncing,sync_last_attempt_at.lt.${staleCutoff}),and(sync_status.eq.syncing,sync_last_attempt_at.is.null)`);

  if (!locked) {
    // Otro worker ya lo tomo (o ya esta synced). Salida silenciosa.
    return { ok: false, reason: "not_found", detail: "already syncing or synced" };
  }

  // 3) Resolver accountId desde la propiedad
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

  // 4) Borrar el PIN viejo si existe (best-effort — si falla, seguimos).
  //    Envolvemos en timeout de 3s — no queremos gastar el budget del serverless
  //    esperando un delete que puede no llegar nunca.
  if (pin.ttlock_pwd_id) {
    try {
      const deletePromise = deleteTTLockPin({
        tenantId: pin.tenant_id,
        propertyId: pin.property_id,
        accountId,
        lockId: pin.ttlock_lock_id,
        keyboardPwdId: pin.ttlock_pwd_id,
      });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 3000),
      );
      await Promise.race([deletePromise, timeoutPromise]);
      // Pausa corta — TTLock a veces no registra el delete antes del add.
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn("[ttlock/sync-pin] delete old pwd failed (continuing):", err);
    }
  }

  // 5) Crear el nuevo PIN en la cerradura.
  //
  // El keyboardPwdName es lo que el host ve en TTLock Web System al lado
  // del codigo. Lo armamos trazable: incluye el channel_code (SH...) o el
  // booking_id corto para que ante un PIN huerfano o un error tipo "ya
  // existe ese codigo" se pueda identificar de que reserva vino con un
  // SELECT directo en bookings. TTLock acepta hasta 32 caracteres en este
  // campo, asi que trim agresivo.
  let channelCode: string | null = null;
  if (pin.booking_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bk } = await (supabaseAdmin.from("bookings") as any)
      .select("channel_code")
      .eq("id", pin.booking_id)
      .maybeSingle();
    channelCode = (bk as { channel_code?: string | null } | null)?.channel_code ?? null;
  }
  const keyboardPwdName = buildPinTrazableName({
    channelCode,
    bookingId: pin.booking_id,
    guestName: pin.guest_name,
  });

  const startDate = new Date(pin.valid_from).getTime();
  const endDate = new Date(pin.valid_to).getTime();
  const params = new URLSearchParams({
    clientId,
    accessToken,
    lockId: String(pin.ttlock_lock_id),
    keyboardPwd: pin.pin,
    keyboardPwdName,
    startDate: String(startDate),
    endDate: String(endDate),
    addType: "2", // via gateway
    date: String(Date.now()),
  });

  try {
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/keyboardPwd/add`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string; keyboardPwdId?: number | string };

    if (json.errcode && json.errcode !== 0) {
      // Lock offline → no quemamos un intento, solo reagendamos
      if (OFFLINE_LOCK_ERRCODES.has(json.errcode)) {
        await updateSyncState(pinId, {
          sync_status: "offline_lock",
          sync_next_retry_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          sync_last_error: `Cerradura offline: ${json.errmsg ?? json.errcode}`,
        });
        return { ok: false, reason: "offline_lock", detail: String(json.errmsg ?? json.errcode) };
      }

      // Auto-heal: TTLock dice "ya existe ese passcode". Significa que el
      // PIN se creo en una corrida anterior pero no logramos persistir el
      // ttlock_pwd_id (Vercel mato la function entre el add exitoso y el
      // UPDATE en BD). En vez de quedar huerfanos para siempre, llamamos
      // listKeyboardPwd, matcheamos por (pin + dates) y adoptamos el id.
      if (isTTLockAlreadyExistsError(json.errcode, json.errmsg)) {
        const reconciled = await reconcileTTLockPin(pinId);
        if (reconciled.ok) {
          return { ok: true, ttlockPwdId: reconciled.ttlockPwdId };
        }
        // No matcheo — registramos como error normal, no agregamos al pool
        // de auto-heal para no loopear infinito.
        const nextAttempts = pin.sync_attempts + 1;
        const retryAt = scheduleRetry(nextAttempts);
        await updateSyncState(pinId, {
          sync_status: retryAt ? "retry" : "failed",
          sync_attempts: nextAttempts,
          sync_next_retry_at: retryAt,
          sync_last_error: `TTLock dice already-exists pero reconcile fallo: ${reconciled.reason}${reconciled.detail ? ` (${reconciled.detail})` : ""}`,
        });
        return { ok: false, reason: "api_error", detail: `already-exists, reconcile failed: ${reconciled.reason}` };
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

/**
 * Marca un pin como pendiente de sync. Llamado despues de crear o editar.
 * No dispara el sync por si solo — el caller decide si llamar syncPinToLock
 * inmediatamente (fire & forget) o dejarselo al worker de retry.
 */
export async function markPinForSync(pinId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin.from("access_pins") as any)
    .update({
      sync_status: "pending",
      sync_attempts: 0,
      sync_next_retry_at: null,
      sync_last_error: null,
    })
    .eq("id", pinId);
}
