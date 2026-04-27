/**
 * GET /api/cron/sync-pins — worker de reintentos de sync PIN → TTLock.
 *
 * Corre cada 15 min (via Vercel cron o external como cron-job.org).
 * Busca access_pins con sync_status IN ('pending','retry','offline_lock')
 * y sync_next_retry_at <= now (o null, recien creados), y los sincroniza
 * uno por uno.
 *
 * Auth: opcional via CRON_SECRET. Si no esta configurado, el endpoint es
 * publico — como el path es conocido solo para el cron, no es un riesgo
 * alto, pero recomendable setearlo.
 *
 * Idempotente: si el sync ya se completo entre requests, updateSyncState
 * optimista evita dobles operaciones.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncPinToLock } from "@/lib/ttlock/sync-pin";
import { syncCyclicPinToLock } from "@/lib/ttlock/cyclic-pin";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

export const maxDuration = 60;

// Batch chico para no pasarse del timeout de Vercel (60s en Pro, 10s free).
// 20 pins * ~1.5s cada uno (delete+add con pausa de 500ms) = ~30s.
const BATCH_SIZE = 20;

export async function GET(req: NextRequest) {
  // Auth dual: aceptamos cron-job.org (Bearer CRON_SECRET) o host autenticado
  // (cookie de sesion). El KeysPanel del dashboard llega con cookie, no
  // Bearer; cron-job.org no tiene cookie pero si Bearer.
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const hasValidBearer = expectedSecret && authHeader === `Bearer ${expectedSecret}`;

  let tenantId: string | null = null;
  if (!hasValidBearer) {
    try {
      const auth = await getAuthenticatedTenant();
      tenantId = auth.tenantId ?? null;
    } catch {
      tenantId = null;
    }
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabaseAdmin.from("access_pins") as any)
    .select("id, is_cyclic")
    .eq("status", "active")
    .or(
      `and(sync_status.in.(pending,retry,offline_lock),or(sync_next_retry_at.is.null,sync_next_retry_at.lte.${now})),` +
      `and(sync_status.eq.syncing,or(sync_last_attempt_at.is.null,sync_last_attempt_at.lt.${staleCutoff}))`,
    )
    .order("sync_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  // Si la auth fue por cookie de tenant, scopeamos al tenant. Si fue Bearer
  // (cron externo), procesamos todos los tenants.
  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data: pending } = await query;

  const rows = (pending ?? []) as { id: string; is_cyclic?: boolean }[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, synced: 0, failed: 0 });
  }

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const result = row.is_cyclic
      ? await syncCyclicPinToLock(row.id)
      : await syncPinToLock(row.id);
    if (result.ok) synced += 1;
    else failed += 1;
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    synced,
    failed,
  });
}
