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
      sync_status, sync_attempts, sync_last_error, sync_next_retry_at, sync_last_attempt_at,
      valid_from, valid_to,
      created_at,
      properties:property_id ( name )
    `)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // NOTA: el trigger de sync del GET se movio al cliente (KeysPanel llama
  // explicitamente a /api/cron/sync-pins). Fire-and-forget aca no funciona
  // en Vercel serverless — el background task muere al cerrar la request y
  // la fila queda stuck en 'syncing'.
  return NextResponse.json({ pins: data ?? [] });
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
  } else if ("ttlock_pwd_id" in patch && patch.ttlock_pwd_id) {
    // Caso especial: algun flow externo (ej. SmartDevicesPanel createPin manual)
    // ya programo el PIN en la cerradura y reporta el ttlock_pwd_id via PATCH.
    // Lo damos por sincronizado para que el badge refleje la realidad.
    patch.sync_status = "synced";
    patch.sync_attempts = 1;
    patch.sync_last_error = null;
    patch.sync_next_retry_at = null;
  }

  const { error, count } = await supabase
    .from("access_pins")
    .update(patch as never, { count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sync sincronico al editar. Misma razon que en /api/bookings/POST:
  // fire-and-forget en Vercel serverless puede quedar stuck si la function
  // muere. Esperamos al resultado — tipicamente 3-6s. Si falla, la fila
  // queda en 'retry' y el worker la retoma despues.
  if (needsResync) {
    try {
      await syncPinToLock(id);
    } catch (err) {
      console.warn("[access-pins/PATCH] resync threw (will retry):", err);
    }
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
