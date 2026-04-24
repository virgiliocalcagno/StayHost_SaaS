import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { syncPinToLock } from "@/lib/ttlock/sync-pin";

/**
 * /api/access-pins — CRUD de códigos de acceso.
 *
 * Scoping: todo está gateado por RLS (tenant_id = current_tenant_id()).
 * El cliente nunca envía tenantId — se resuelve del cookie de sesión.
 */

// GET /api/access-pins → lista todos los PINs del tenant
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("access_pins")
    .select(`
      id, property_id, booking_id,
      ttlock_lock_id, ttlock_pwd_id,
      guest_name, guest_phone, pin,
      source, status, delivery_status,
      sync_status, sync_attempts, sync_last_error, sync_next_retry_at,
      valid_from, valid_to,
      created_at,
      properties:property_id ( name )
    `)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire & forget: cuando el host abre el panel, re-intentamos sync de
  // todos los pending/retry cuya ventana de backoff ya venció. Reemplaza
  // el cron de Vercel (limitado a 2/dia en plan free).
  const pins = (data ?? []) as Array<{
    id: string;
    sync_status?: string | null;
    sync_next_retry_at?: string | null;
    status?: string | null;
  }>;
  const now = Date.now();
  const pendingIds = pins
    .filter((p) => {
      if (p.status !== "active") return false;
      if (!p.sync_status || p.sync_status === "synced" || p.sync_status === "syncing") return false;
      if (p.sync_status === "failed") return false;
      if (!p.sync_next_retry_at) return true;
      return new Date(p.sync_next_retry_at).getTime() <= now;
    })
    .slice(0, 10) // tope pequeño para no bloquear la respuesta
    .map((p) => p.id);

  if (pendingIds.length > 0) {
    // void: no esperamos. El usuario ve la lista actual; el siguiente
    // refetch del panel mostrara los nuevos estados.
    void Promise.all(
      pendingIds.map((id) =>
        syncPinToLock(id).catch((err) => {
          console.warn("[access-pins/GET] background sync failed:", err);
        }),
      ),
    );
  }

  return NextResponse.json({ pins });
}

// POST /api/access-pins → crea un PIN
// Body: {
//   propertyId, guestName, pin, validFrom, validTo,
//   guestPhone?, bookingId?, ttlockLockId?, ttlockPwdId?, source?
// }
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = String(body.propertyId ?? "");
  const guestName = String(body.guestName ?? "").trim();
  const pin = String(body.pin ?? "").trim();
  const validFrom = String(body.validFrom ?? "");
  const validTo = String(body.validTo ?? "");

  if (!propertyId || !guestName || !pin || !validFrom || !validTo) {
    return NextResponse.json(
      { error: "propertyId, guestName, pin, validFrom y validTo son obligatorios" },
      { status: 400 }
    );
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "PIN debe tener 4-8 dígitos" }, { status: 400 });
  }
  if (new Date(validTo) <= new Date(validFrom)) {
    return NextResponse.json(
      { error: "validTo debe ser posterior a validFrom" },
      { status: 400 }
    );
  }

  const source = String(body.source ?? "manual");
  const allowedSources = new Set(["manual", "airbnb_ical", "vrbo_ical", "direct_booking"]);
  if (!allowedSources.has(source)) {
    return NextResponse.json({ error: "source inválido" }, { status: 400 });
  }

  // Estado de entrega al huésped. Se usa desde KeysPanel para saber si ya
  // se avisó al huésped del código. Default = pending (apenas lo creamos).
  const deliveryStatus = body.deliveryStatus
    ? String(body.deliveryStatus)
    : "pending";
  const allowedDelivery = new Set(["pending", "sent", "confirmed"]);
  if (!allowedDelivery.has(deliveryStatus)) {
    return NextResponse.json({ error: "deliveryStatus inválido" }, { status: 400 });
  }

  const row = {
    tenant_id: tenantId,
    property_id: propertyId,
    booking_id: body.bookingId ? String(body.bookingId) : null,
    ttlock_lock_id: body.ttlockLockId ? String(body.ttlockLockId) : null,
    ttlock_pwd_id: body.ttlockPwdId ? String(body.ttlockPwdId) : null,
    guest_name: guestName,
    guest_phone: body.guestPhone ? String(body.guestPhone) : null,
    pin,
    source,
    status: "active" as const,
    delivery_status: deliveryStatus,
    valid_from: validFrom,
    valid_to: validTo,
  };

  const { data, error } = await supabase
    .from("access_pins")
    .insert(row as never)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

// PATCH /api/access-pins
// Body: { id, ...patch }
// Permite actualizar status (revocar), valid_from, valid_to y el pwd_id.
export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = new Set([
    "status", "delivery_status",
    "valid_from", "valid_to",
    "ttlock_pwd_id", "pin",
    "guest_name", "guest_phone",
  ]);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "id") continue;
    if (!allowed.has(k)) continue;
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  // Si cambia algo que afecta la cerradura (pin, fechas, revocacion),
  // marcamos para re-sync. El worker se encarga de borrar el pwd viejo
  // en TTLock y crear el nuevo.
  const needsResync = ["pin", "valid_from", "valid_to", "status"].some((k) => k in patch);
  if (needsResync) {
    patch.sync_status = "pending";
    patch.sync_attempts = 0;
    patch.sync_next_retry_at = null;
    patch.sync_last_error = null;
  }

  const { error, count } = await supabase
    .from("access_pins")
    .update(patch as never, { count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fire & forget: si marcamos para resync, disparamos inmediatamente.
  // No bloqueamos la respuesta al host — si falla, el worker retry agarra.
  if (needsResync) {
    void syncPinToLock(id).catch((err) => {
      console.warn("[access-pins/PATCH] resync failed (will retry):", err);
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/access-pins?id=xxx
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("access_pins")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
