import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// POST /api/checkin/lookup
// Body: { code: string }
//
// Endpoint PÚBLICO — el huésped NO está autenticado todavía. Su credencial
// es el código de reserva (que recibió en su canal: Airbnb, VRBO, Booking,
// o el que le mandó el host si es directa).
//
// Usamos service_role porque:
//   1. No hay sesión del huésped.
//   2. El lookup tiene que atravesar RLS (cada tenant tiene sus bookings).
//   3. La seguridad viene del match exacto del código + rate-limit, no de RLS.
//
// Los códigos Airbnb (HMXXXXXXXX) son ~36^8 combinaciones — espacio sobrado
// contra fuerza bruta combinado con rate-limit agresivo por IP (20/15min).

type LookupResult = {
  ok: true;
  booking: {
    id: string;
    channelCode: string;
    propertyId: string;
    propertyName: string | null;
    propertyAddress: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestName: string | null;
    tenantId: string;
    phoneLast4: string | null;
  };
};

type LookupError = { ok: false; error: string };

// Rate-limit super simple en memoria por IP. Para multi-instancia usar Redis
// o una tabla Supabase; esto aguanta single-region y es suficiente para MVP.
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 15 * 60 * 1000; // 15 min

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attemptsByIp.get(ip);
  if (!entry || entry.resetAt < now) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse<LookupResult | LookupError>> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: "Demasiados intentos. Esperá 15 minutos." },
      { status: 429 }
    );
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim().toUpperCase();

  if (!code || code.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Código de reserva inválido" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, tenant_id, channel_code, phone_last4, property_id, guest_name, check_in, check_out, properties:property_id(name, address)"
    )
    .eq("channel_code", code)
    .eq("status", "confirmed")
    .limit(2);

  if (error) {
    console.error("[/api/checkin/lookup]", error);
    return NextResponse.json({ ok: false, error: "Error en el servidor" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No encontramos una reserva con ese código." },
      { status: 404 }
    );
  }

  // Más de un match = colisión (improbable con códigos Airbnb/SH únicos).
  if (data.length > 1) {
    console.warn("[/api/checkin/lookup] multiple matches for", { code });
    return NextResponse.json(
      { ok: false, error: "No pudimos verificar tu reserva. Contacta al anfitrión." },
      { status: 409 }
    );
  }

  const b = data[0] as {
    id: string;
    tenant_id: string;
    channel_code: string;
    phone_last4: string | null;
    property_id: string;
    guest_name: string | null;
    check_in: string;
    check_out: string;
    properties: { name: string | null; address: string | null } | null;
  };
  const phoneLast4 = b.phone_last4 ?? "";

  const nights = Math.max(
    1,
    Math.round(
      (new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / (1000 * 60 * 60 * 24)
    )
  );

  // Buscar/crear checkin_record para este booking. La API de huésped
  // (uploadId, payElectricity, etc.) usa checkin_records.id como identidad,
  // no bookings.id. Retornamos el id correcto para que el flow funcione.
  let checkinRecordId: string | null = null;
  const { data: existingRecords } = await supabaseAdmin
    .from("checkin_records")
    .select("id")
    .eq("booking_ref", b.id)
    .eq("tenant_id", b.tenant_id)
    .limit(1);

  if (existingRecords && existingRecords.length > 0) {
    checkinRecordId = (existingRecords[0] as { id: string }).id;
    // Sincronizar credenciales del record existente con las del lookup.
    // Si fue creado por autoSync antes de que el booking tuviera
    // channel_code, su guest_last_name podría no coincidir — el uploadId
    // fallaría con 401. Actualizamos para dejar auth consistente.
    await supabaseAdmin
      .from("checkin_records")
      .update({
        guest_last_name: b.channel_code.toLowerCase().trim(),
        last_four_digits: phoneLast4,
      } as never)
      .eq("id", checkinRecordId);
  } else {
    // Crear uno nuevo al vuelo. Usamos channel_code como guest_last_name
    // (soft-token) y phoneLast4 como last_four_digits para que los demás
    // endpoints de huésped autentiquen sin pedir nada más.
    const newId = `ci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error: insertErr } = await supabaseAdmin
      .from("checkin_records")
      .insert({
        id: newId,
        tenant_id: b.tenant_id,
        guest_name: b.guest_name ?? "Huésped",
        guest_last_name: b.channel_code.toLowerCase().trim(),
        last_four_digits: phoneLast4,
        checkin: b.check_in,
        checkout: b.check_out,
        nights,
        property_id: b.property_id,
        property_name: b.properties?.name ?? "Propiedad",
        property_address: b.properties?.address ?? null,
        status: "pendiente",
        id_status: "pending",
        source: "auto_direct",
        booking_ref: b.id,
        access_granted: false,
        electricity_enabled: true,
        electricity_rate: 5,
        electricity_paid: false,
        electricity_total: 0,
        paypal_fee_included: true,
      } as never);
    if (insertErr) {
      console.error("[/api/checkin/lookup] create checkin_record failed:", insertErr);
    } else {
      checkinRecordId = newId;
    }
  }

  return NextResponse.json({
    ok: true,
    booking: {
      id: checkinRecordId ?? b.id,   // ← ahora es checkin_records.id, no bookings.id
      bookingId: b.id,                // por si el cliente necesita el original
      channelCode: b.channel_code,
      propertyId: b.property_id,
      propertyName: b.properties?.name ?? null,
      propertyAddress: b.properties?.address ?? null,
      checkIn: b.check_in,
      checkOut: b.check_out,
      nights,
      guestName: b.guest_name,
      tenantId: b.tenant_id,
      phoneLast4: b.phone_last4,
    },
  });
}
