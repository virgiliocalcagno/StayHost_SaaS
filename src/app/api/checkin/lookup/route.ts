import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// POST /api/checkin/lookup
// Body: { code: string, phoneLast4: string }
//
// Endpoint PÚBLICO — el huésped NO está autenticado todavía. Su credencial
// viene del código de reserva (que recibió en su canal: Airbnb, VRBO,
// Booking, o el que le mandó el host si es directa) combinado con los
// últimos 4 dígitos del teléfono que registró al reservar.
//
// Usamos service_role porque:
//   1. No hay sesión del huésped.
//   2. El lookup tiene que atravesar RLS (cada tenant tiene sus bookings).
//   3. La seguridad viene del match exacto (código + 4 dígitos), no de RLS.
//
// Los códigos Airbnb (HMXXXXXXXX) son ~36^8 combinaciones. Combinados con
// los últimos 4 dígitos del teléfono (10^4) el espacio es suficientemente
// grande para descartar ataques de fuerza bruta, y además se agrega
// rate-limit por IP abajo.

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

  let body: { code?: string; phoneLast4?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  const phoneLast4 = String(body.phoneLast4 ?? "").trim();

  if (!code || code.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Código de reserva inválido" },
      { status: 400 }
    );
  }
  if (!/^\d{4}$/.test(phoneLast4)) {
    return NextResponse.json(
      { ok: false, error: "Los últimos 4 dígitos deben ser numéricos" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, tenant_id, channel_code, property_id, guest_name, check_in, check_out, properties:property_id(name, address)"
    )
    .eq("channel_code", code)
    .eq("phone_last4", phoneLast4)
    .eq("status", "confirmed")
    .limit(2);

  if (error) {
    console.error("[/api/checkin/lookup]", error);
    return NextResponse.json({ ok: false, error: "Error en el servidor" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No encontramos una reserva con ese código y teléfono." },
      { status: 404 }
    );
  }

  // Más de un match = colisión (improbable) → rechazamos por seguridad.
  if (data.length > 1) {
    console.warn("[/api/checkin/lookup] multiple matches for", { code, phoneLast4 });
    return NextResponse.json(
      { ok: false, error: "No pudimos verificar tu reserva. Contacta al anfitrión." },
      { status: 409 }
    );
  }

  const b = data[0] as {
    id: string;
    tenant_id: string;
    channel_code: string;
    property_id: string;
    guest_name: string | null;
    check_in: string;
    check_out: string;
    properties: { name: string | null; address: string | null } | null;
  };

  const nights = Math.max(
    1,
    Math.round(
      (new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / (1000 * 60 * 60 * 24)
    )
  );

  return NextResponse.json({
    ok: true,
    booking: {
      id: b.id,
      channelCode: b.channel_code,
      propertyId: b.property_id,
      propertyName: b.properties?.name ?? null,
      propertyAddress: b.properties?.address ?? null,
      checkIn: b.check_in,
      checkOut: b.check_out,
      nights,
      guestName: b.guest_name,
      tenantId: b.tenant_id,
    },
  });
}
