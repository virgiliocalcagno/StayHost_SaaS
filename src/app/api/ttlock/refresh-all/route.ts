/**
 * TTLock — refresh periódico de tokens.
 *
 * Llamado por:
 *  - Vercel Cron (GET con header `Authorization: Bearer <CRON_SECRET>`).
 *  - O por el usuario dueño de una cuenta (GET/POST desde el panel) — en ese
 *    caso solo refresca las cuentas del tenant del usuario autenticado.
 *
 * Renovamos si el token vence en <= 14 días (los tokens TTLock viven 90 días
 * pero con buffer amplio evitamos que el usuario se tope con TOKEN_EXPIRED).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TTLOCK_API = process.env.TTLOCK_API_URL ?? "https://euapi.ttlock.com";
const REFRESH_IF_EXPIRES_WITHIN_MS = 14 * 24 * 60 * 60 * 1000; // 14 días

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
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

type AccountRow = {
  id: string;
  tenant_id: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  label: string | null;
};

async function refreshRows(rows: AccountRow[]) {
  const now = Date.now();
  const results: Array<{ id: string; label: string | null; status: "renewed" | "skipped" | "failed"; error?: string }> = [];

  for (const row of rows) {
    if (!row.refresh_token) {
      results.push({ id: row.id, label: row.label, status: "failed", error: "no refresh_token" });
      continue;
    }
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
    if (expiresAt - now > REFRESH_IF_EXPIRES_WITHIN_MS) {
      results.push({ id: row.id, label: row.label, status: "skipped" });
      continue;
    }

    const tok = await oauthRefresh(row.refresh_token);
    if (!tok?.access_token) {
      results.push({
        id: row.id,
        label: row.label,
        status: "failed",
        error: "refresh_token rechazado — reconexión manual requerida",
      });
      continue;
    }

    const newExpiresAt = new Date(now + (tok.expires_in ?? 7776000) * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("ttlock_accounts")
      .update({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? row.refresh_token,
        token_expires_at: newExpiresAt,
      } as never)
      .eq("id", row.id);

    if (error) {
      results.push({ id: row.id, label: row.label, status: "failed", error: error.message });
    } else {
      results.push({ id: row.id, label: row.label, status: "renewed" });
    }
  }

  return results;
}

// Cron path: verifica el Authorization bearer contra CRON_SECRET y corre
// refresh para TODAS las cuentas de TODOS los tenants.
async function handleCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("ttlock_accounts")
    .select("id, tenant_id, refresh_token, token_expires_at, label");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await refreshRows((data ?? []) as AccountRow[]);
  return NextResponse.json({ scope: "cron", checked: results.length, results });
}

// User path: refresca solo las cuentas del tenant autenticado. Útil como
// botón "Refrescar tokens" en la UI.
async function handleUser() {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("ttlock_accounts")
    .select("id, tenant_id, refresh_token, token_expires_at, label")
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await refreshRows((data ?? []) as AccountRow[]);
  return NextResponse.json({ scope: "user", checked: results.length, results });
}

export async function GET(req: NextRequest) {
  const hasAuth = req.headers.get("authorization")?.startsWith("Bearer ");
  if (hasAuth) return handleCron(req);
  return handleUser();
}

export async function POST() {
  return handleUser();
}
