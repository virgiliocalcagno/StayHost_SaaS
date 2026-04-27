/**
 * POST /api/admin/ttlock-reconcile
 *
 * Endpoint admin one-shot para reconciliar PINs huerfanos (rows con
 * ttlock_pwd_id=NULL pero el PIN ya existe en la cerradura). Caso tipico:
 * el sync inicial crasheo entre el add exitoso a TTLock y el UPDATE en
 * BD, dejando un huerfano que el cron nunca puede crear de nuevo porque
 * TTLock dice "passcode already exists".
 *
 * Para cada huerfano: llama listKeyboardPwd, matchea por (pin + dates) y
 * adopta el keyboardPwdId. Tambien renombra el PIN al patron trazable
 * `SH#<channel_code>` para facilitar debugging futuro.
 *
 * Auth: solo MASTER (Virgilio). Es operacion destructiva-en-potencia
 * (modifica TTLock + BD), no la queremos accesible al resto de tenants.
 *
 * Body opcional:
 *   { tenantId?: string, propertyId?: string }
 * Si no vienen, reconcilia TODOS los huerfanos del MASTER. Filtros para
 * scoping en pruebas.
 *
 * Response:
 *   { reconciled: [...], failed: [...], total: N }
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileTTLockPin, renamePinToTrazable } from "@/lib/ttlock/reconcile-pin";

const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

async function requireMaster() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const email = (user.email ?? "").trim().toLowerCase();
  if (email !== MASTER_EMAIL) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function POST(req: NextRequest) {
  const guard = await requireMaster();
  if (!guard.ok) return guard.response;

  let body: { tenantId?: string; propertyId?: string; mode?: "reconcile" | "rename" } = {};
  try {
    body = await req.json();
  } catch {
    // body vacio es OK
  }
  const mode = body.mode ?? "reconcile";

  if (mode === "rename") {
    // Rename retroactivo: para todos los PINs ya sincronizados, aplica el
    // patron trazable nuevo en TTLock. Util cuando se cambia el formato del
    // nombre (ej. quitar prefijo SH# redundante en channelCode SH...).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renameQuery = (supabaseAdmin.from("access_pins") as any)
      .select("id, pin")
      .not("ttlock_pwd_id", "is", null)
      .not("ttlock_lock_id", "is", null)
      .eq("status", "active");
    if (body.tenantId) renameQuery = renameQuery.eq("tenant_id", body.tenantId);
    if (body.propertyId) renameQuery = renameQuery.eq("property_id", body.propertyId);

    const { data: synced, error } = await renameQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (synced ?? []) as Array<{ id: string; pin: string }>;

    const renamed: Array<{ pinId: string; pin: string; newName: string }> = [];
    const failed: Array<{ pinId: string; pin: string; reason: string; detail?: string }> = [];
    for (const row of rows) {
      const r = await renamePinToTrazable(row.id);
      if (r.ok) {
        renamed.push({ pinId: row.id, pin: row.pin, newName: r.newName });
      } else {
        failed.push({ pinId: row.id, pin: row.pin, reason: r.reason, detail: r.detail });
      }
    }
    return NextResponse.json({ mode, total: rows.length, renamed, failed });
  }

  // Modo default: reconciliar huerfanos (ttlock_pwd_id IS NULL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabaseAdmin.from("access_pins") as any)
    .select("id, tenant_id, property_id, pin, valid_from, valid_to, guest_name")
    .is("ttlock_pwd_id", null)
    .eq("status", "active")
    .not("ttlock_lock_id", "is", null);

  if (body.tenantId) query = query.eq("tenant_id", body.tenantId);
  if (body.propertyId) query = query.eq("property_id", body.propertyId);

  const { data: huerfanos, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (huerfanos ?? []) as Array<{
    id: string;
    pin: string;
    valid_from: string;
    valid_to: string;
    guest_name: string | null;
  }>;

  const reconciled: Array<{ pinId: string; pin: string; ttlockPwdId: string; renamed: boolean }> = [];
  const failed: Array<{ pinId: string; pin: string; reason: string; detail?: string }> = [];

  for (const row of rows) {
    const result = await reconcileTTLockPin(row.id);
    if (result.ok) {
      reconciled.push({
        pinId: row.id,
        pin: row.pin,
        ttlockPwdId: result.ttlockPwdId,
        renamed: result.renamed,
      });
    } else {
      failed.push({
        pinId: row.id,
        pin: row.pin,
        reason: result.reason,
        detail: result.detail,
      });
    }
  }

  return NextResponse.json({ mode, total: rows.length, reconciled, failed });
}
