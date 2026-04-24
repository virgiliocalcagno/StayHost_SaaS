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

export const maxDuration = 60;

// Batch chico para no pasarse del timeout de Vercel (60s en Pro, 10s free).
// 20 pins * ~1.5s cada uno (delete+add con pausa de 500ms) = ~30s.
const BATCH_SIZE = 20;

export async function GET(req: NextRequest) {
  // Auth opcional: si CRON_SECRET esta seteado, exigir header.
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pending } = await (supabaseAdmin.from("access_pins") as any)
    .select("id")
    .in("sync_status", ["pending", "retry", "offline_lock"])
    .or(`sync_next_retry_at.is.null,sync_next_retry_at.lte.${now}`)
    .eq("status", "active")
    .order("sync_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  const rows = (pending ?? []) as { id: string }[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, synced: 0, failed: 0 });
  }

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await syncPinToLock(row.id);
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
