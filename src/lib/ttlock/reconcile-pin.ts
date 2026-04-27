/**
 * TTLock — reconciliacion de PINs huerfanos.
 *
 * Caso de uso: el sync inicial sufrio una crash entre "TTLock acepto el
 * add y devolvio keyboardPwdId" y "BD persiste el ttlock_pwd_id". Ej:
 * Vercel mata la function por timeout, o un fetch retry fallido. Resultado:
 * el PIN ESTA en la cerradura, pero StayHost cree que no, y el cron retrya
 * con error "passcode already exists".
 *
 * Solucion: listar los PINs en la cerradura via `/v3/lock/listKeyboardPwd`,
 * matchear por (codigo, valid_from, valid_to) y "adoptar" el keyboardPwdId
 * existente — UPDATE access_pins.ttlock_pwd_id sin tocar la cerradura.
 *
 * Bonus: rename del nombre en TTLock al patron trazable nuevo
 * (`SH#<channel_code>`) para que listados futuros sean trazables tambien
 * para los PINs creados antes del fix de naming.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const TTLOCK_REQUEST_TIMEOUT_MS = 5000;
const TTLOCK_PWD_NAME_MAX = 32;

/**
 * Construye el nombre trazable que va al `keyboardPwdName` de TTLock.
 *
 * Formato: `<NUMERO_RESERVA> - <NOMBRE_HUESPED>`. Ejemplos:
 *   SH75E74DEE - yo                       (reserva directa StayHost)
 *   HMF5B83RFW - Reserva Confirmada       (iCal Airbnb sin nombre real)
 *   HMZFMHKXSM - Juan Perez               (iCal Airbnb con nombre)
 *   A95CC9C9 - Maria                      (manual sin channel_code → bookingId)
 *
 * Reglas:
 * - Sin prefijo SH#: el formato del channel_code (SH..., HM..., VRBO...)
 *   ya identifica el origen sin ruido visual.
 * - 32 chars max (limite TTLock). Si el nombre no entra, se trunca al
 *   final — el codigo va primero porque es la pieza critica para trazar.
 * - Fallback a `Reserva` si no hay guest_name (caso bloqueos).
 */
export function buildPinTrazableName(args: {
  channelCode: string | null;
  bookingId: string | null;
  guestName: string | null;
}): string {
  const { channelCode, bookingId, guestName } = args;
  const code =
    channelCode ??
    (bookingId
      ? bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()
      : "MANUAL");
  const name = (guestName ?? "Reserva").trim() || "Reserva";
  const full = `${code} - ${name}`;
  return full.slice(0, TTLOCK_PWD_NAME_MAX);
}

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

type TTLockPwdEntry = {
  keyboardPwdId: number | string;
  keyboardPwd: string;
  keyboardPwdName?: string;
  startDate: number;
  endDate: number;
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
 * Lista todos los PINs registrados en una cerradura. TTLock pagina por 100
 * (max documentado), entonces iteramos hasta agotar.
 */
async function listKeyboardPwds(args: {
  accessToken: string;
  clientId: string;
  lockId: string;
}): Promise<TTLockPwdEntry[]> {
  const { accessToken, clientId, lockId } = args;
  const all: TTLockPwdEntry[] = [];
  let pageNo = 1;
  const pageSize = 100;
  // Tope defensivo: si la cerradura tiene > 1000 PINs algo esta muy mal y
  // no queremos colgar la function.
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      clientId,
      accessToken,
      lockId,
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      date: String(Date.now()),
    });
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/lock/listKeyboardPwd`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      list?: TTLockPwdEntry[];
      pages?: number;
      total?: number;
    };
    if (json.errcode && json.errcode !== 0) {
      throw new Error(`listKeyboardPwd error ${json.errcode}: ${json.errmsg ?? ""}`);
    }
    const list = json.list ?? [];
    all.push(...list);
    if (list.length < pageSize) break;
    pageNo += 1;
  }
  return all;
}

/**
 * Rename de un PIN existente via /v3/keyboardPwd/change. TTLock no tiene
 * endpoint dedicado para renombrar — change permite modificar pwd, name,
 * y/o dates en una sola llamada. Aca solo mandamos keyboardPwdName.
 *
 * Devuelve detail con errcode+errmsg para que el caller pueda surface al
 * usuario cuando falla. Best-effort en el flow del sync inicial; en el
 * endpoint admin de rename retroactivo usamos el detail para diagnosticar.
 */
async function renameKeyboardPwd(args: {
  accessToken: string;
  clientId: string;
  lockId: string;
  keyboardPwdId: string;
  newName: string;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const params = new URLSearchParams({
    clientId: args.clientId,
    accessToken: args.accessToken,
    lockId: args.lockId,
    keyboardPwdId: args.keyboardPwdId,
    newKeyboardPwdName: args.newName,
    changeType: "2", // via gateway
    date: String(Date.now()),
  });
  try {
    const res = await fetchWithTimeout(`${TTLOCK_API}/v3/keyboardPwd/change`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    if (json.errcode && json.errcode !== 0) {
      const detail = `errcode=${json.errcode} errmsg=${json.errmsg ?? ""}`;
      console.warn(`[ttlock/reconcile] rename failed: ${detail}`);
      return { ok: false, detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[ttlock/reconcile] rename network error:", detail);
    return { ok: false, detail };
  }
}

export type ReconcileResult =
  | { ok: true; ttlockPwdId: string; renamed: boolean }
  | { ok: false; reason: "not_found" | "no_lock" | "no_account" | "no_token" | "no_match" | "api_error" | "network_error"; detail?: string };

/**
 * Intenta linkear un access_pin huerfano (ttlock_pwd_id=NULL) con un PIN
 * que ya existe en la cerradura. Match por (keyboardPwd === pin.pin) y
 * dates aproximadas (±5 min de tolerancia para diferencias de timezone).
 *
 * Si encuentra match: UPDATE access_pins.ttlock_pwd_id, marca synced, y
 * (best-effort) rename del PIN en TTLock al patron trazable nuevo.
 */
export async function reconcileTTLockPin(pinId: string): Promise<ReconcileResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow } = await (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, booking_id, ttlock_lock_id, pin, valid_from, valid_to, guest_name")
    .eq("id", pinId)
    .maybeSingle();
  const pin = pinRow as {
    id: string; tenant_id: string; property_id: string;
    booking_id: string | null; ttlock_lock_id: string | null;
    pin: string; valid_from: string; valid_to: string;
    guest_name: string | null;
  } | null;
  if (!pin) return { ok: false, reason: "not_found" };
  if (!pin.ttlock_lock_id) return { ok: false, reason: "no_lock" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prop } = await (supabaseAdmin.from("properties") as any)
    .select("ttlock_account_id")
    .eq("id", pin.property_id)
    .maybeSingle();
  const accountId = (prop as { ttlock_account_id?: string | null } | null)?.ttlock_account_id ?? null;
  if (!accountId) return { ok: false, reason: "no_account" };

  const accessToken = await resolveAccessToken(accountId, pin.tenant_id);
  if (!accessToken) return { ok: false, reason: "no_token" };

  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return { ok: false, reason: "no_token", detail: "TTLOCK_CLIENT_ID no configurado" };

  let entries: TTLockPwdEntry[];
  try {
    entries = await listKeyboardPwds({
      accessToken,
      clientId,
      lockId: String(pin.ttlock_lock_id),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "api_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Match: misma keyboardPwd y misma ventana de validez. Tolerancia de
  // 5 min porque TTLock puede redondear segundos al minuto al guardar.
  const validFromMs = new Date(pin.valid_from).getTime();
  const validToMs = new Date(pin.valid_to).getTime();
  const TOLERANCE = 5 * 60 * 1000;
  const match = entries.find((e) => {
    if (String(e.keyboardPwd) !== String(pin.pin)) return false;
    return (
      Math.abs(e.startDate - validFromMs) <= TOLERANCE &&
      Math.abs(e.endDate - validToMs) <= TOLERANCE
    );
  });

  if (!match) {
    return { ok: false, reason: "no_match", detail: `pin=${pin.pin} no encontrado en cerradura` };
  }

  const adoptedPwdId = String(match.keyboardPwdId);

  // Persistir el ttlock_pwd_id encontrado y marcar synced.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin.from("access_pins") as any)
    .update({
      ttlock_pwd_id: adoptedPwdId,
      sync_status: "synced",
      sync_attempts: 0,
      sync_next_retry_at: null,
      sync_last_error: null,
      sync_last_attempt_at: new Date().toISOString(),
    })
    .eq("id", pinId);

  // Rename best-effort al naming trazable.
  let renamed = false;
  if (pin.booking_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bk } = await (supabaseAdmin.from("bookings") as any)
      .select("channel_code")
      .eq("id", pin.booking_id)
      .maybeSingle();
    const channelCode = (bk as { channel_code?: string | null } | null)?.channel_code ?? null;
    const newName = buildPinTrazableName({
      channelCode,
      bookingId: pin.booking_id,
      guestName: pin.guest_name,
    });
    const renameRes = await renameKeyboardPwd({
      accessToken,
      clientId,
      lockId: String(pin.ttlock_lock_id),
      keyboardPwdId: adoptedPwdId,
      newName,
    });
    renamed = renameRes.ok;
  }

  return { ok: true, ttlockPwdId: adoptedPwdId, renamed };
}

/**
 * Detector de errores TTLock que indican "este PIN ya existe en la
 * cerradura". TTLock no documenta errcodes exhaustivamente, asi que
 * matcheamos por substring del errmsg como red defensiva.
 */
export function isTTLockAlreadyExistsError(errcode: number | undefined, errmsg: string | undefined): boolean {
  if (!errmsg) return false;
  const msg = errmsg.toLowerCase();
  return (
    msg.includes("already exist") ||
    msg.includes("same passcode") ||
    msg.includes("duplicate")
  );
}

/**
 * Rename retroactivo: para un access_pin ya sincronizado (con
 * ttlock_pwd_id), genera el nombre trazable nuevo y lo aplica en TTLock
 * via /v3/keyboardPwd/changeName. Idempotente — si ya tiene el nombre
 * correcto, TTLock no se queja igual.
 *
 * Uso: endpoint admin one-shot para corregir nombres legacy
 * ("StayHost - Reserva Confirmada", "SH#SH...") al patron limpio.
 */
export type RenameResult =
  | { ok: true; newName: string }
  | { ok: false; reason: "not_found" | "no_pwd_id" | "no_lock" | "no_account" | "no_token" | "rename_failed"; detail?: string };

export async function renamePinToTrazable(pinId: string): Promise<RenameResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow } = await (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, booking_id, ttlock_lock_id, ttlock_pwd_id, guest_name")
    .eq("id", pinId)
    .maybeSingle();
  const pin = pinRow as {
    id: string; tenant_id: string; property_id: string;
    booking_id: string | null; ttlock_lock_id: string | null;
    ttlock_pwd_id: string | null; guest_name: string | null;
  } | null;
  if (!pin) return { ok: false, reason: "not_found" };
  if (!pin.ttlock_pwd_id) return { ok: false, reason: "no_pwd_id" };
  if (!pin.ttlock_lock_id) return { ok: false, reason: "no_lock" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prop } = await (supabaseAdmin.from("properties") as any)
    .select("ttlock_account_id")
    .eq("id", pin.property_id)
    .maybeSingle();
  const accountId = (prop as { ttlock_account_id?: string | null } | null)?.ttlock_account_id ?? null;
  if (!accountId) return { ok: false, reason: "no_account" };

  const accessToken = await resolveAccessToken(accountId, pin.tenant_id);
  if (!accessToken) return { ok: false, reason: "no_token" };
  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return { ok: false, reason: "no_token", detail: "TTLOCK_CLIENT_ID no configurado" };

  // Construir el nombre trazable nuevo via helper compartido.
  let channelCode: string | null = null;
  if (pin.booking_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bk } = await (supabaseAdmin.from("bookings") as any)
      .select("channel_code")
      .eq("id", pin.booking_id)
      .maybeSingle();
    channelCode = (bk as { channel_code?: string | null } | null)?.channel_code ?? null;
  }
  const newName = buildPinTrazableName({
    channelCode,
    bookingId: pin.booking_id,
    guestName: pin.guest_name,
  });

  const renameRes = await renameKeyboardPwd({
    accessToken,
    clientId,
    lockId: String(pin.ttlock_lock_id),
    keyboardPwdId: pin.ttlock_pwd_id,
    newName,
  });
  if (!renameRes.ok) return { ok: false, reason: "rename_failed", detail: renameRes.detail };
  return { ok: true, newName };
}
