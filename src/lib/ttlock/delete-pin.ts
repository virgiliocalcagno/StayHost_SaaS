/**
 * TTLock — borrar PIN físico de la cerradura.
 *
 * Se llama desde los flujos de cleanup (cancelar reserva, resetear check-in)
 * para que el código en la puerta deje de abrir inmediatamente, no cuando
 * venza el `valid_to` del access_pin.
 *
 * Best-effort: si TTLock está caído, el token expiró o la cuenta fue
 * desconectada, loguea el error y devuelve `{ ok: false }` pero NO tira.
 * El caller debe borrar igual el access_pin de BD — no podemos dejar al
 * host bloqueado por un fallo de red. El leak en la cerradura física es
 * menor que el riesgo de no poder cancelar una reserva.
 *
 * El helper reimplementa `getAccessToken` + `oauthRefresh` en vez de
 * importarlos del endpoint para no acoplar dos paths críticos de auth: si
 * algo raro pasa con este delete, el path de crear PIN sigue funcionando.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";

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

  const res = await fetch(`${TTLOCK_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) return null;
  return json;
}

async function resolveAccessToken(accountId: string, tenantId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("ttlock_accounts")
    .select("id, tenant_id, access_token, refresh_token, token_expires_at")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle<AccountRow>();
  if (!row) return null;

  if (row.access_token && row.token_expires_at) {
    const expiresAt = new Date(row.token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return row.access_token;
  }
  if (!row.refresh_token) return null;

  const refreshed = await oauthRefresh(row.refresh_token);
  if (!refreshed?.access_token) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin.from("ttlock_accounts") as any)
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? row.refresh_token,
      token_expires_at: new Date(Date.now() + (refreshed.expires_in ?? 7_776_000) * 1000).toISOString(),
    })
    .eq("id", accountId);

  return refreshed.access_token;
}

export type DeleteTTLockPinResult =
  | { ok: true }
  | { ok: false; reason: "missing_params" | "no_account" | "no_token" | "api_error" | "network_error"; detail?: string };

/**
 * Borra un PIN de la cerradura TTLock. Resuelve el `accountId` desde la
 * propiedad si no se pasa explícito. Nunca tira — devuelve `{ok:false}` y
 * el caller decide qué hacer.
 */
export async function deleteTTLockPin(params: {
  tenantId: string;
  propertyId?: string | null;
  accountId?: string | null;
  lockId: string | number | null | undefined;
  keyboardPwdId: string | number | null | undefined;
}): Promise<DeleteTTLockPinResult> {
  const { tenantId, propertyId } = params;
  const lockId = params.lockId != null ? String(params.lockId) : "";
  const keyboardPwdId = params.keyboardPwdId != null ? String(params.keyboardPwdId) : "";
  if (!tenantId || !lockId || !keyboardPwdId) {
    return { ok: false, reason: "missing_params" };
  }

  // Resolver accountId desde la propiedad si no vino explícito.
  let accountId = params.accountId ?? null;
  if (!accountId && propertyId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prop } = await (supabaseAdmin.from("properties") as any)
      .select("ttlock_account_id")
      .eq("id", propertyId)
      .maybeSingle();
    accountId = (prop as { ttlock_account_id?: string | null } | null)?.ttlock_account_id ?? null;
  }
  if (!accountId) return { ok: false, reason: "no_account" };

  const accessToken = await resolveAccessToken(accountId, tenantId);
  if (!accessToken) return { ok: false, reason: "no_token" };

  const clientId = process.env.TTLOCK_CLIENT_ID;
  if (!clientId) return { ok: false, reason: "no_token", detail: "TTLOCK_CLIENT_ID no configurado" };

  const form = new URLSearchParams({
    clientId,
    accessToken,
    lockId,
    keyboardPwdId,
    deleteType: "2", // via gateway
    date: String(Date.now()),
  });

  try {
    const res = await fetch(`${TTLOCK_API}/v3/keyboardPwd/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    if (json.errcode && json.errcode !== 0) {
      return { ok: false, reason: "api_error", detail: `${json.errcode}: ${json.errmsg ?? ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "network_error", detail: String(err) };
  }
}
