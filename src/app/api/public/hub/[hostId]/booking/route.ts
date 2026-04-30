/**
 * POST /api/public/hub/[hostId]/booking
 *
 * Endpoint PUBLICO (sin sesion) para que un huesped solicite una reserva
 * desde el Hub del host. Soporta dos flujos según `paymentMethod`:
 *
 *   - 'manual'  → Crea pending_review como hasta ahora. El host aprueba
 *                 desde el panel y coordina el cobro por fuera.
 *
 *   - 'paypal'  → Crea pending_review con payment_token + total_price ya
 *                 calculado (incluye processing_fee del host) y devuelve
 *                 un `payUrl` apuntando a /hub/[hostId]/pay/[token]. El
 *                 huésped paga ahí; al capturarse se auto-confirma.
 *
 * Validaciones:
 *   - hostId existe (tenant real).
 *   - propertyId pertenece a ese tenant.
 *   - checkIn < checkOut.
 *   - Campos minimos del huesped: nombre + telefono + doc + nacionalidad.
 *   - guestDocPhotoPath debe estar bajo `{tenantId}/hub-requests/...`.
 *   - paymentMethod=paypal solo si el host tiene PayPal habilitado.
 *
 * Side effects en flow paypal:
 *   - Genera payment_token. NO crea aún la PayPal order — la crea el
 *     endpoint /api/public/payments/paypal/create-order cuando el huésped
 *     hace click en el Smart Button. Mantiene este endpoint barato.
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
    const guestEmail = body.guestEmail ? String(body.guestEmail).trim().toLowerCase() : null;
    const guestPhone = String(body.guestPhone ?? "").trim();
    const guestDoc = String(body.guestDoc ?? "").trim();
    const guestNationality = String(body.guestNationality ?? "").trim();
    const guestDocPhotoPath =
      typeof body.guestDocPhotoPath === "string" ? body.guestDocPhotoPath : null;
    const numGuests = Number(body.numGuests ?? 1);
    const note = body.note ? String(body.note).trim().slice(0, 500) : null;

    // Validación email opcional pero si viene, debe ser válido. Lo
    // necesitamos para mandar el recibo post-pago.
    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

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

    // Validar property pertenece al tenant. Traemos también precio +
    // cleaning fees porque si paymentMethod=paypal el server tiene que
    // calcular el total autoritativo (no confiar en el cliente).
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, tenant_id, prop_status, direct_enabled, price, currency, cleaning_fee_one_day, cleaning_fee_more_days")
      .eq("id", propertyId)
      .maybeSingle();
    const propRow = prop as {
      id: string;
      tenant_id: string;
      prop_status: string | null;
      direct_enabled: boolean | null;
      price: number | null;
      currency: string | null;
      cleaning_fee_one_day: number | null;
      cleaning_fee_more_days: number | null;
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

    // Método de pago: 'paypal' o 'manual' (default).
    const paymentMethod = body.paymentMethod === "paypal" ? "paypal" : "manual";

    // Si el huésped quiere pagar online, el host debe tener PayPal
    // habilitado. Si no, fallback silencioso a manual no es buena UX —
    // mejor 400 explícito así el front re-renderiza con lo que toca.
    let processingFeePercent = 0;
    if (paymentMethod === "paypal") {
      const { data: pp } = await supabaseAdmin
        .from("tenant_payment_configs")
        .select("client_id, enabled, processing_fee_percent")
        .eq("tenant_id", tenantId)
        .eq("provider", "paypal")
        .maybeSingle();
      const ppCfg = pp as {
        client_id: string | null; enabled: boolean; processing_fee_percent: number | string | null;
      } | null;
      if (!ppCfg || !ppCfg.enabled || !ppCfg.client_id) {
        return NextResponse.json(
          { error: "Este host no acepta pagos online por ahora. Elegí pago manual." },
          { status: 400 }
        );
      }
      processingFeePercent = Number(ppCfg.processing_fee_percent ?? 0);
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

    // Cálculo autoritativo del total cuando hay pago online. Replica la
    // fórmula del Hub (subtotal + 16% impuestos + processing_fee). Para
    // método manual el total queda null — el host lo fija al aprobar.
    let totalPrice: number | null = null;
    let paymentToken: string | null = null;
    if (paymentMethod === "paypal") {
      const nights = Math.max(
        1,
        Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
      );
      const pricePerNight = Number(propRow.price ?? 0);
      const cleaning = nights === 1
        ? Number(propRow.cleaning_fee_one_day ?? 0)
        : Number(propRow.cleaning_fee_more_days ?? 0);
      const subtotal = pricePerNight * nights + cleaning;
      const taxes = Math.round(subtotal * 0.16);
      const baseTotal = subtotal + taxes;
      const processingFee = Math.round((baseTotal * processingFeePercent) / 100);
      totalPrice = baseTotal + processingFee;
      paymentToken = crypto.randomUUID();
    }

    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      property_id: propertyId,
      source: "hub",
      source_uid: sourceUid,
      status: "pending_review",
      check_in: checkIn,
      check_out: checkOut,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      guest_doc: guestDoc,
      guest_nationality: guestNationality,
      guest_doc_photo_path: guestDocPhotoPath,
      num_guests: numGuests,
      total_price: totalPrice,
      note,
      phone_last4: phoneLast4,
      channel_code: null,
      payment_method: paymentMethod,
      payment_token: paymentToken,
    };
    if (paymentMethod === "paypal") {
      insertPayload.payment_provider = "paypal";
    }

    const { data: insertRes, error: insertErr } = await supabaseAdmin
      .from("bookings")
      .insert(insertPayload as never)
      .select("id")
      .single();

    if (insertErr) {
      console.error("[hub/booking] insert failed:", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const bookingId = (insertRes as { id: string }).id;

    if (paymentMethod === "paypal" && paymentToken) {
      // payUrl es relativo al hostId — construirlo con el origin del request
      // para soportar dominios custom en el futuro sin tocar el front.
      const origin = req.nextUrl.origin;
      return NextResponse.json({
        ok: true,
        requestId: bookingId,
        paymentMethod: "paypal",
        payUrl: `${origin}/hub/${tenantId}/pay/${paymentToken}`,
        total: totalPrice,
        message: "Te llevamos a la pasarela de pago para confirmar la reserva.",
      });
    }

    return NextResponse.json({
      ok: true,
      requestId: bookingId,
      paymentMethod: "manual",
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
