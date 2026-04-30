/**
 * POST /api/public/hub/[hostId]/booking
 *
 * Endpoint PUBLICO (sin sesion) para que un huesped solicite una reserva
 * desde el Hub del host. Crea una fila en bookings con
 *   status = 'pending_review'  (no bloquea overlap; el host aprueba)
 *   source = 'hub'               (distinguible de manual/airbnb/vrbo/etc.)
 *
 * Validaciones:
 *   - hostId existe (tenant real).
 *   - propertyId pertenece a ese tenant.
 *   - checkIn < checkOut.
 *   - Campos minimos del huesped: nombre + telefono + doc + nacionalidad.
 *     Sin doc no permitimos solicitar — politica del SaaS para LATAM:
 *     trazabilidad e identificacion del huesped son obligatorias.
 *   - guestDocPhotoPath debe estar bajo `{tenantId}/hub-requests/...`
 *     para evitar que un atacante referencie fotos de OTRO tenant.
 *
 * Anti-abuso:
 *   - Sin rate limiting por IP por ahora (TODO: Upstash o tabla con
 *     INSERT OR IGNORE por ip+timestamp). El Hub no es scrapeable
 *     trivialmente y la foto del documento sube fricción.
 *
 * Side effects:
 *   - Ninguno hasta que el host apruebe. NO crea PIN, NO genera
 *     channel_code, NO toca cleaning_tasks. Esos pasan en /approve.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const E164_PHONE = /^\+?[1-9][\d\s-]{6,18}$/;
const PATH_RE = /^[0-9a-f-]{36}\/hub-requests\/[0-9a-f-]+\.(jpg|jpeg|png)$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  try {
    const { hostId } = await params;
    if (!hostId) {
      return NextResponse.json({ error: "hostId required" }, { status: 400 });
    }

    // Validar tenant existe.
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", hostId)
      .maybeSingle();
    if (!tenant) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }
    const tenantId = (tenant as { id: string }).id;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const propertyId = String(body.propertyId ?? "").trim();
    const checkIn = String(body.checkIn ?? "").trim();
    const checkOut = String(body.checkOut ?? "").trim();
    const guestName = String(body.guestName ?? "").trim();
    const guestPhone = String(body.guestPhone ?? "").trim();
    const guestDoc = String(body.guestDoc ?? "").trim();
    const guestNationality = String(body.guestNationality ?? "").trim();
    const guestDocPhotoPath =
      typeof body.guestDocPhotoPath === "string" ? body.guestDocPhotoPath : null;
    const numGuests = Number(body.numGuests ?? 1);
    const note = body.note ? String(body.note).trim().slice(0, 500) : null;

    if (!propertyId || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "propertyId, checkIn, checkOut son requeridos" },
        { status: 400 }
      );
    }
    if (String(checkIn) >= String(checkOut)) {
      return NextResponse.json(
        { error: "checkOut debe ser posterior a checkIn" },
        { status: 400 }
      );
    }
    if (!guestName || guestName.length < 3) {
      return NextResponse.json({ error: "Nombre del huésped requerido" }, { status: 400 });
    }
    if (!guestPhone || !E164_PHONE.test(guestPhone)) {
      return NextResponse.json(
        { error: "Teléfono requerido en formato internacional" },
        { status: 400 }
      );
    }
    if (!guestDoc || guestDoc.length < 4) {
      return NextResponse.json(
        { error: "Documento de identidad requerido" },
        { status: 400 }
      );
    }
    if (!guestNationality || guestNationality.length < 2) {
      return NextResponse.json({ error: "Nacionalidad requerida" }, { status: 400 });
    }
    if (Number.isNaN(numGuests) || numGuests < 1 || numGuests > 50) {
      return NextResponse.json({ error: "numGuests inválido" }, { status: 400 });
    }
    if (guestDocPhotoPath && !PATH_RE.test(guestDocPhotoPath)) {
      return NextResponse.json(
        { error: "Foto del documento con path inválido" },
        { status: 400 }
      );
    }
    // El path debe pertenecer al MISMO tenant — defensa contra cliente que
    // pega un path de otro hub.
    if (guestDocPhotoPath && !guestDocPhotoPath.startsWith(`${tenantId}/`)) {
      return NextResponse.json(
        { error: "Foto del documento no corresponde a este Hub" },
        { status: 400 }
      );
    }

    // Validar property pertenece al tenant.
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, tenant_id, prop_status, direct_enabled")
      .eq("id", propertyId)
      .maybeSingle();
    const propRow = prop as {
      id: string;
      tenant_id: string;
      prop_status: string | null;
      direct_enabled: boolean | null;
    } | null;
    if (!propRow || propRow.tenant_id !== tenantId) {
      return NextResponse.json({ error: "Propiedad no encontrada" }, { status: 404 });
    }
    if (propRow.prop_status === "inactive" || propRow.direct_enabled === false) {
      return NextResponse.json(
        { error: "Esta propiedad no está aceptando reservas directas" },
        { status: 403 }
      );
    }

    // VALIDAR DISPONIBILIDAD: si las fechas chocan con un booking
    // confirmed o blocked, rechazamos sin crear la solicitud. Las
    // pending_review NO bloquean (el host puede recibir multiples
    // solicitudes y elegir cual aprobar).
    const { data: overlapping } = await supabaseAdmin
      .from("bookings")
      .select("id, check_in, check_out, status")
      .eq("property_id", propertyId)
      .in("status", ["confirmed", "blocked"])
      .lt("check_in", checkOut)
      .gt("check_out", checkIn)
      .limit(1);

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json(
        {
          error: "Las fechas seleccionadas no están disponibles",
          available: false,
        },
        { status: 409 }
      );
    }

    // Last-4 del telefono para que el host lo identifique rapido.
    const phoneDigits = guestPhone.replace(/\D/g, "");
    const phoneLast4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;

    const sourceUid = `hub-${crypto.randomUUID()}`;

    const { data: insertRes, error: insertErr } = await supabaseAdmin
      .from("bookings")
      .insert({
        tenant_id: tenantId,
        property_id: propertyId,
        source: "hub",
        source_uid: sourceUid,
        status: "pending_review",
        check_in: checkIn,
        check_out: checkOut,
        guest_name: guestName,
        guest_phone: guestPhone,
        guest_doc: guestDoc,
        guest_nationality: guestNationality,
        guest_doc_photo_path: guestDocPhotoPath,
        num_guests: numGuests,
        total_price: null, // El host fija el precio al aprobar.
        note,
        phone_last4: phoneLast4,
        // No generamos channel_code todavia — lo crea /approve al confirmar.
        channel_code: null,
      } as never)
      .select("id")
      .single();

    if (insertErr) {
      console.error("[hub/booking] insert failed:", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const bookingId = (insertRes as { id: string }).id;

    return NextResponse.json({
      ok: true,
      requestId: bookingId,
      message: "Solicitud enviada. El host la revisará y te confirmará pronto.",
    });
  } catch (err) {
    console.error("[hub/booking] unhandled:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
