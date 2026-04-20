/**
 * TTLock Webhook — /api/ttlock/webhook
 *
 * TTLock's Open Platform does NOT sign callbacks. Our authentication layer is
 * a shared secret passed as `?token=...` on the callback URL registered in
 * the TTLock developer portal. The secret lives in `TTLOCK_WEBHOOK_TOKEN`.
 *
 * In addition we:
 *   1. Verify the `clientId` field on the body matches `TTLOCK_CLIENT_ID`
 *      (so leaked URLs from unrelated TTLock tenants can't feed us events).
 *   2. Reject events whose `serverDate` is more than ±10 min off the server
 *      clock — anti-replay guard.
 *   3. Resolve `lockId` → property → tenant via `properties.ttlock_lock_id`.
 *      Events for unknown locks are still persisted (tenant_id nullable) so
 *      we have breadcrumbs when debugging configuration issues.
 *   4. Upsert into `ttlock_events` with a unique key on
 *      `(lock_id, server_date, record_type)` so retries are idempotent.
 *
 * We ALWAYS return HTTP 200 "success" to TTLock — they retry aggressively on
 * any other status, which would cause duplicates. Rejections are logged as
 * warnings, not surfaced to the caller.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000; // ±10 min

function ok() {
  // TTLock expects the literal string "success" with HTTP 200.
  return new NextResponse("success", { status: 200 });
}

// TTLock sends GET to verify the callback URL at registration time.
export async function GET() {
  return ok();
}

/**
 * Parse the incoming webhook body. TTLock sends
 * `application/x-www-form-urlencoded`, but some integrations send JSON. We
 * try form first and fall back to JSON.
 */
async function readPayload(req: NextRequest): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const out: Record<string, unknown> = {};
      for (const [k, v] of params) out[k] = v;
      return out;
    }
    if (ct.includes("application/json")) {
      return (await req.json()) as Record<string, unknown>;
    }
    // Unknown / missing Content-Type — try form first, JSON second.
    const text = await req.text();
    const params = new URLSearchParams(text);
    if ([...params.keys()].length > 0) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of params) out[k] = v;
      return out;
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  } catch {
    return {};
  }
}

function intOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bigintOrNull(v: unknown): number | null {
  // JS Number is fine for ms timestamps through year 2286. We skip BigInt to
  // keep JSON serialization simple — Postgres `bigint` accepts number.
  return intOrNull(v);
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // ── 1. Shared-secret gate ────────────────────────────────────────────────
  // If TTLOCK_WEBHOOK_TOKEN is set, the callback URL MUST include a matching
  // `?token=` query param. If it's not set, we accept all callers (dev mode)
  // but log a warning so prod misconfig is visible.
  const expectedToken = process.env.TTLOCK_WEBHOOK_TOKEN;
  const providedToken = url.searchParams.get("token");
  if (expectedToken) {
    if (providedToken !== expectedToken) {
      console.warn("[ttlock/webhook] rejected: bad or missing ?token=");
      return ok(); // still 200 to stop retries
    }
  } else {
    console.warn("[ttlock/webhook] TTLOCK_WEBHOOK_TOKEN not set — accepting unauthenticated webhook");
  }

  const payload = await readPayload(req);

  // ── 2. Client ID check ──────────────────────────────────────────────────
  const expectedClientId = process.env.TTLOCK_CLIENT_ID;
  const payloadClientId = strOrNull(payload.clientId);
  if (expectedClientId && payloadClientId && payloadClientId !== expectedClientId) {
    console.warn(
      "[ttlock/webhook] rejected: clientId mismatch",
      { expected: expectedClientId, got: payloadClientId }
    );
    return ok();
  }

  // ── 3. Anti-replay via serverDate ───────────────────────────────────────
  const serverDate = bigintOrNull(payload.serverDate);
  if (serverDate !== null) {
    const skew = Math.abs(Date.now() - serverDate);
    if (skew > MAX_CLOCK_SKEW_MS) {
      console.warn(
        "[ttlock/webhook] rejected: serverDate too far from now",
        { serverDate, skewMs: skew }
      );
      return ok();
    }
  }

  // ── 4. Resolve tenant/property from lockId ──────────────────────────────
  const lockId = strOrNull(payload.lockId);
  if (!lockId) {
    console.warn("[ttlock/webhook] rejected: missing lockId", { payload });
    return ok();
  }

  let tenantId: string | null = null;
  let propertyId: string | null = null;
  try {
    // `ttlock_lock_id` is stored as text. TTLock sends it either as a number
    // or a string depending on the event type, so we compare as text.
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, tenant_id")
      .eq("ttlock_lock_id", lockId)
      .maybeSingle<{ id: string; tenant_id: string }>();
    if (prop) {
      tenantId = prop.tenant_id;
      propertyId = prop.id;
    } else {
      console.warn("[ttlock/webhook] lockId not mapped to any property", { lockId });
    }
  } catch (err) {
    console.error("[ttlock/webhook] failed to look up property:", err);
  }

  // ── 5. Persist (idempotent upsert) ──────────────────────────────────────
  const row = {
    tenant_id: tenantId,
    property_id: propertyId,
    lock_id: lockId,
    record_type: intOrNull(payload.recordType),
    success: intOrNull(payload.success),
    username: strOrNull(payload.username),
    keyboard_pwd: strOrNull(payload.keyboardPwd),
    server_date: serverDate,
    electric_quantity: intOrNull(payload.electricQuantity),
    notify_type: intOrNull(payload.notifyType),
    raw: payload,
  };

  try {
    // We can't express the partial unique index in `onConflict` directly, so
    // we do an explicit check + insert. For the common case (record_type and
    // server_date present) we rely on the unique index to reject dupes; for
    // the edge case (missing either), we insert unconditionally.
    if (row.server_date !== null && row.record_type !== null) {
      const { error } = await supabaseAdmin
        .from("ttlock_events")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(row as any, {
          onConflict: "lock_id,server_date,record_type",
          ignoreDuplicates: true,
        });
      if (error) console.error("[ttlock/webhook] upsert failed:", error);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabaseAdmin.from("ttlock_events").insert(row as any);
      if (error) console.error("[ttlock/webhook] insert failed:", error);
    }
  } catch (err) {
    console.error("[ttlock/webhook] unexpected persist error:", err);
  }

  return ok();
}
