import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cascadeCancelBooking } from "@/lib/bookings/cleanup";
import { syncPinToLock } from "@/lib/ttlock/sync-pin";
import {
  ensureCleaningTaskForBlock,
  removeCleaningTaskForBlock,
} from "@/lib/cleaning/ensure-block-task";

const VALID_BLOCK_TYPES = ["maintenance", "personal", "pre_booking", "other"] as const;
type BlockType = (typeof VALID_BLOCK_TYPES)[number];
const isValidBlockType = (v: unknown): v is BlockType =>
  typeof v === "string" && (VALID_BLOCK_TYPES as readonly string[]).includes(v);

// All three handlers read the tenant_id from the authenticated session
// cookie. They no longer accept `tenantEmail` in the body or `?email=` in
// the query — those were the backdoor that let anyone with the right email
// read or delete someone else's data.

// POST /api/bookings — create a manual booking or block
//
// Validates:
//  - propertyId belongs to caller's tenant (RLS enforces, but we pre-check so
//    we can return a nicer error than a generic insert failure).
//  - checkIn < checkOut.
//  - No overlap with any non-cancelled booking on that property. Overlap rule
//    is [a.check_in, a.check_out) intersects [new.checkIn, new.checkOut):
//       a.check_in < new.checkOut AND a.check_out > new.checkIn
//    We treat `blocked` ranges as overlapping too (owner holds → no guest).
//  - source_uid: client may pass one for idempotency (retry-safe double
//    clicks); otherwise we generate a stable UUID. Old `manual-${Date.now()}`
//    could collide if two users clicked in the same millisecond.
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      propertyId, checkIn, checkOut,
      guestName, guestPhone, guestDoc, guestNationality, guestDocPhotoPath,
      source, note, numGuests, totalPrice,
      sourceUid: clientSourceUid,
      // Bloqueos: tipo (maintenance/personal/pre_booking/other) + flag de
      // limpieza. Solo aplican cuando source === "block"; ignorados para
      // reservas reales.
      blockType, requiresCleaning,
    } = body;

    if (!propertyId || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "propertyId, checkIn, checkOut required" },
        { status: 400 }
      );
    }

    // Date sanity — YYYY-MM-DD strings compare lexically, which works here.
    if (String(checkIn) >= String(checkOut)) {
      return NextResponse.json(
        { error: "checkOut debe ser posterior a checkIn" },
        { status: 400 }
      );
    }

    const isBlock = source === "block";

    // Overlap check. RLS on `bookings` already filters by tenant, so this
    // query only sees the caller's own bookings — which is exactly what we
    // want: two different tenants can't have bookings on the same property
    // anyway (properties have a single tenant_id).
    const { data: overlapping, error: overlapErr } = await supabase
      .from("bookings")
      .select("id, check_in, check_out, guest_name, status")
      .eq("property_id", propertyId)
      .neq("status", "cancelled")
      .lt("check_in", checkOut)
      .gt("check_out", checkIn)
      .limit(1);

    if (overlapErr) {
      return NextResponse.json({ error: overlapErr.message }, { status: 500 });
    }
    if (overlapping && overlapping.length > 0) {
      const o = overlapping[0] as {
        id: string; check_in: string; check_out: string;
        guest_name: string; status: string;
      };
      return NextResponse.json(
        {
          error: "Las fechas se solapan con otra reserva",
          conflict: {
            id: o.id,
            checkIn: o.check_in,
            checkOut: o.check_out,
            guest: o.guest_name,
            status: o.status,
          },
        },
        { status: 409 }
      );
    }

    // Stable UUID beats `manual-${Date.now()}` — no collision under
    // concurrent creates, and lets the client send the same value to retry
    // idempotently.
    const sourceUid =
      typeof clientSourceUid === "string" && clientSourceUid.length > 0
        ? clientSourceUid
        : `manual-${crypto.randomUUID()}`;

    // Código de reserva para login del huésped en /checkin. Formato
    // "SHXXXXXXXX" — 2 letras prefijo (StayHost) + 8 hex, mismo largo
    // que Airbnb (HM........) y VRBO. Sin guion porque es mas natural
    // de tipear y compartir por whatsapp. Las reservas iCal reciben su
    // codigo desde el parser (HM... de Airbnb).
    const channelCode = isBlock
      ? null
      : `SH${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    // Últimos 4 dígitos del teléfono para auth del huésped.
    const phoneLast4 = (() => {
      if (isBlock || !guestPhone) return null;
      const digits = String(guestPhone).replace(/\D/g, "");
      return digits.length >= 4 ? digits.slice(-4) : null;
    })();

    // Si es bloqueo, validamos blockType y normalizamos requiresCleaning.
    // Bloqueos viejos / clientes que no envien estos campos quedan con
    // block_type=null (tratado como "other" en la UI).
    const blockTypeValue: BlockType | null = isBlock
      ? (isValidBlockType(blockType) ? blockType : null)
      : null;
    const requiresCleaningValue: boolean = isBlock
      ? Boolean(requiresCleaning)
      : false;

    const insertRow: Record<string, unknown> = {
      property_id: propertyId,
      tenant_id: tenantId,
      source_uid: sourceUid,
      source: source ?? "manual",
      guest_name: guestName ?? (isBlock ? "Bloqueado" : "Huésped"),
      guest_phone: guestPhone ?? null,
      guest_doc: guestDoc ?? null,
      guest_nationality: guestNationality ?? null,
      guest_doc_photo_path: guestDocPhotoPath ?? null,
      check_in: checkIn,
      check_out: checkOut,
      status: isBlock ? "blocked" : "confirmed",
      total_price: totalPrice ?? 0,
      num_guests: numGuests ?? 1,
      note: note ?? null,
      channel_code: channelCode,
      phone_last4: phoneLast4,
      block_type: blockTypeValue,
      requires_cleaning: requiresCleaningValue,
    };

    let insertRes = await supabase.from("bookings").insert(insertRow as never).select("id").single();

    // Fallback: si las columnas nuevas no existen todavía en prod, reintentar
    // sin ellas. Una vez corridas las migraciones esto es no-op.
    const errMsg = insertRes.error?.message ?? "";
    if (
      errMsg.includes("channel_code") ||
      errMsg.includes("phone_last4") ||
      errMsg.includes("guest_doc_photo_path") ||
      errMsg.includes("block_type") ||
      errMsg.includes("requires_cleaning")
    ) {
      delete insertRow.channel_code;
      delete insertRow.phone_last4;
      delete insertRow.guest_doc_photo_path;
      delete insertRow.block_type;
      delete insertRow.requires_cleaning;
      insertRes = await supabase.from("bookings").insert(insertRow as never).select("id").single();
    }

    const { data, error } = insertRes;

    if (error) {
      // 23505 = unique_violation. If client sent a sourceUid that already
      // exists, treat as idempotent "already created" rather than 500.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { ok: true, idempotent: true, sourceUid },
          { status: 200 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const bookingId = (data as { id: string }).id;

    // Auto-create PIN if guest has phone
    if (!isBlock && guestPhone) {
      try {
        const last4 = String(guestPhone).replace(/\D/g, "").slice(-4);
        if (last4.length === 4) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: prop } = await (supabaseAdmin.from("properties") as any)
            .select("ttlock_lock_id, check_in_time, check_out_time")
            .eq("id", propertyId)
            .single();

          const ciTime = prop?.check_in_time ?? "14:00";
          const coTime = prop?.check_out_time ?? "12:00";

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: insertedPin } = await (supabaseAdmin.from("access_pins") as any)
            .insert({
              tenant_id: tenantId,
              property_id: propertyId,
              booking_id: bookingId,
              ttlock_lock_id: prop?.ttlock_lock_id ? String(prop.ttlock_lock_id) : null,
              guest_name: guestName ?? "Huésped",
              guest_phone: guestPhone,
              pin: last4,
              source: source === "block" ? "manual" : "direct_booking",
              status: "active",
              delivery_status: "pending",
              valid_from: new Date(`${checkIn}T${ciTime}:00`).toISOString(),
              valid_to: new Date(`${checkOut}T${coTime}:00`).toISOString(),
              // sync_status default 'pending' lo pone la BD si la migracion corrio.
              // Si no corrio, el insert igual funciona (el campo queda omitido).
            })
            .select("id")
            .single();

          // Sync sincronico (no fire-and-forget) — Vercel serverless puede
          // matar background tasks al cerrar la request, lo que dejaba la
          // fila stuck en 'syncing'. Esperamos hasta que termine (tipicamente
          // 3-6s). Si falla, syncPinToLock ya marca la fila como retry con
          // backoff, asi que el worker/panel la retoma despues.
          if (prop?.ttlock_lock_id && insertedPin?.id) {
            try {
              await syncPinToLock(insertedPin.id);
            } catch (err) {
              console.warn("[bookings/POST] initial pin sync threw (will retry):", err);
            }
          }
        }
      } catch (pinErr) {
        console.error("[bookings/POST] auto-PIN creation failed (non-fatal):", pinErr);
      }
    }

    // Auto-crear checkin_record para que la reserva aparezca de una en el
    // panel de Check-ins sin tener que esperar al autoSync del frontend.
    // Espeja la lógica de /api/checkin/lookup para que los dos caminos
    // (host crea reserva / huésped busca por código) generen el mismo
    // registro. Idempotente: si ya existe un record con booking_ref = este
    // booking, no hace nada.
    if (!isBlock) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prop } = await (supabaseAdmin.from("properties") as any)
          .select("name, address, wifi_name, wifi_password, electricity_enabled, electricity_rate")
          .eq("id", propertyId)
          .single();

        const nights = Math.max(
          1,
          Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)
        );
        const chan = String(source ?? "manual").toLowerCase();
        const isVrbo = chan === "vrbo";
        const propertyElectricityEnabled = prop?.electricity_enabled ?? true;
        const electricityRate = prop?.electricity_rate ?? 0;
        const electricityEnabledForGuest = propertyElectricityEnabled && !isVrbo && electricityRate > 0;
        const electricityTotal = electricityEnabledForGuest ? electricityRate * nights : 0;

        const insertRow: Record<string, unknown> = {
          id: `ci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenant_id: tenantId,
          guest_name: guestName ?? "Huésped",
          // Soft-token: usamos el channel_code SHXXXX (lowercased). El auth
          // del huesped hace match contra esto cuando viene de un link v=2.
          guest_last_name: (channelCode ?? "").toLowerCase().trim(),
          last_four_digits: phoneLast4 ?? "0000",
          checkin: checkIn,
          checkout: checkOut,
          nights,
          property_id: propertyId,
          property_name: prop?.name ?? "Propiedad",
          property_address: prop?.address ?? null,
          wifi_ssid: prop?.wifi_name ?? null,
          wifi_password: prop?.wifi_password ?? null,
          status: "pendiente",
          id_status: "pending",
          source: chan === "ical" || chan === "airbnb" || chan === "vrbo" ? "auto_ical" : "auto_direct",
          channel: chan === "manual" ? "direct" : chan,
          booking_ref: bookingId,
          access_granted: false,
          electricity_enabled: electricityEnabledForGuest,
          electricity_rate: electricityRate,
          electricity_paid: false,
          electricity_total: electricityTotal,
          paypal_fee_included: true,
          missing_data: false,
        };
        // Heredar datos OCR si el host los cargo (escaneo al crear reserva)
        if (guestName && guestName !== "Reserva Confirmada" && guestName !== "Huésped") {
          insertRow.ocr_name = guestName;
        }
        if (guestDoc) insertRow.ocr_document = guestDoc;
        if (guestNationality) insertRow.ocr_nationality = guestNationality;
        if (guestDoc || guestNationality) insertRow.ocr_confidence = 1.0;

        // Heredar la foto del ID escaneada por el host → el huésped no
        // vuelve a subirla en el Paso 2 del check-in. id_status='validated'
        // hace que el Step2State.needsPhoto sea false y el flujo salte
        // directo a los datos de contacto.
        if (guestDocPhotoPath) {
          insertRow.id_photo_path = guestDocPhotoPath;
          insertRow.id_status = "validated";
        }

        // Chequear primero si ya existe (el UNIQUE en booking_ref puede no
        // estar aplicado en prod, por eso no usamos onConflict). Este POST
        // corre una vez por reserva, la race condition real es minima.
        const { data: existingCi } = await supabaseAdmin
          .from("checkin_records")
          .select("id")
          .eq("booking_ref", bookingId)
          .limit(1);
        if (!existingCi || existingCi.length === 0) {
          const { error: ciErr } = await supabaseAdmin
            .from("checkin_records")
            .insert(insertRow as never);
          if (ciErr) {
            console.error("[bookings/POST] auto-checkin creation failed (non-fatal):", ciErr);
          }
        }
      } catch (ciErr) {
        console.error("[bookings/POST] auto-checkin creation failed (non-fatal):", ciErr);
      }
    }

    // Bloqueos con requires_cleaning=true: generamos la cleaning_task
    // automaticamente. La tarea queda programada para el dia de check_out
    // del bloqueo a la hora de check-out de la propiedad — simetrica a
    // como funcionan las reservas.
    if (isBlock && requiresCleaningValue) {
      try {
        await ensureCleaningTaskForBlock({
          supabase: supabaseAdmin,
          tenantId,
          bookingId,
          propertyId: String(propertyId),
          checkOut: String(checkOut),
          blockType: blockTypeValue,
        });
      } catch (taskErr) {
        console.error("[bookings/POST] block cleaning task creation failed (non-fatal):", taskErr);
      }
    }

    return NextResponse.json({
      ok: true,
      id: bookingId,
      channelCode,       // para que el UI muestre el codigo generado
      phoneLast4,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/bookings — update a booking
// Allowed fields: guestName, guestPhone, checkIn, checkOut, totalPrice, note,
// numGuests, status. Validates date overlap if dates change.
export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { bookingId, ...fields } = body;
    if (!bookingId) {
      return NextResponse.json({ error: "bookingId required" }, { status: 400 });
    }

    const allowed: Record<string, string> = {
      guestName: "guest_name",
      guestPhone: "guest_phone",
      guestDoc: "guest_doc",
      guestNationality: "guest_nationality",
      guestDocPhotoPath: "guest_doc_photo_path",
      checkIn: "check_in",
      checkOut: "check_out",
      totalPrice: "total_price",
      numGuests: "num_guests",
      note: "note",
      status: "status",
      blockType: "block_type",
      requiresCleaning: "requires_cleaning",
    };

    const patch: Record<string, unknown> = {};
    for (const [key, col] of Object.entries(allowed)) {
      if (key in fields) patch[col] = fields[key];
    }
    // Validar block_type si vino en el patch
    if ("block_type" in patch && patch.block_type !== null && !isValidBlockType(patch.block_type)) {
      return NextResponse.json(
        { error: `block_type invalido. Esperado: ${VALID_BLOCK_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // If dates changed, validate overlap
    if (patch.check_in || patch.check_out) {
      // Get current booking to know property and current dates
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: current } = await (supabase.from("bookings") as any)
        .select("property_id, check_in, check_out")
        .eq("id", bookingId)
        .single();

      if (!current) {
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const newCheckIn = (patch.check_in ?? current.check_in) as string;
      const newCheckOut = (patch.check_out ?? current.check_out) as string;

      if (newCheckIn >= newCheckOut) {
        return NextResponse.json({ error: "checkOut debe ser posterior a checkIn" }, { status: 400 });
      }

      const { data: overlapping } = await supabase
        .from("bookings")
        .select("id")
        .eq("property_id", current.property_id)
        .neq("status", "cancelled")
        .neq("id", bookingId)
        .lt("check_in", newCheckOut)
        .gt("check_out", newCheckIn)
        .limit(1);

      if (overlapping && overlapping.length > 0) {
        return NextResponse.json({ error: "Las fechas se solapan con otra reserva" }, { status: 409 });
      }

      // Update associated PIN validity if dates changed
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prop } = await (supabaseAdmin.from("properties") as any)
          .select("check_in_time, check_out_time")
          .eq("id", current.property_id)
          .single();

        const ciTime = prop?.check_in_time ?? "14:00";
        const coTime = prop?.check_out_time ?? "12:00";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseAdmin.from("access_pins") as any)
          .update({
            valid_from: new Date(`${newCheckIn}T${ciTime}:00`).toISOString(),
            valid_to: new Date(`${newCheckOut}T${coTime}:00`).toISOString(),
          })
          .eq("booking_id", bookingId);
      } catch {}
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("bookings") as any)
      .update(patch)
      .eq("id", bookingId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Cuando se cancela, limpiamos todo lo asociado: check-in records,
    // access_pins (y en el futuro el PIN físico en TTLock). Un booking
    // cancelado no debe tener rastros operativos — el huésped ya no puede
    // ni hacer check-in ni abrir la puerta.
    if (patch.status === "cancelled") {
      await cascadeCancelBooking(bookingId);
    }

    // Sincronizar cleaning_task de bloqueos cuando cambian flag o tipo.
    // - requires_cleaning true → asegurar task (idempotente)
    // - requires_cleaning false → quitar task pendiente
    // - block_type cambia con flag activo → recrear task con label nuevo
    if ("requires_cleaning" in patch || "block_type" in patch || patch.check_out) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: bk } = await (supabaseAdmin.from("bookings") as any)
          .select("source, property_id, tenant_id, check_out, block_type, requires_cleaning")
          .eq("id", bookingId)
          .single();
        if (bk && bk.source === "block") {
          if (bk.requires_cleaning) {
            // Si cambio el block_type, borramos la task vieja para recrearla
            // con el label correcto.
            if ("block_type" in patch) {
              await removeCleaningTaskForBlock({ supabase: supabaseAdmin, bookingId });
            }
            await ensureCleaningTaskForBlock({
              supabase: supabaseAdmin,
              tenantId: bk.tenant_id,
              bookingId,
              propertyId: bk.property_id,
              checkOut: bk.check_out,
              blockType: bk.block_type,
            });
          } else {
            await removeCleaningTaskForBlock({ supabase: supabaseAdmin, bookingId });
          }
        }
      } catch (taskErr) {
        console.error("[bookings/PATCH] block task sync failed (non-fatal):", taskErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/bookings?bookingId=xxx — delete a booking or block
// RLS enforces that the booking must belong to the current tenant. If the
// caller passes a bookingId they don't own, the delete is a no-op (0 rows
// affected).
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const bookingId = req.nextUrl.searchParams.get("bookingId");
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  // Cleanup completo: check-in records + access_pins (y TTLock físico
  // cuando se implemente). Corre ANTES de borrar el booking para que las
  // rows dependientes salgan primero.
  await cascadeCancelBooking(bookingId);

  const { error, count } = await supabase
    .from("bookings")
    .delete({ count: "exact" })
    .eq("id", bookingId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// GET /api/bookings
// Returns the tenant's properties + their bookings (excluding cancelled).
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const { data: props } = await supabase
    .from("properties")
    .select("id, name, address, price, ical_airbnb, ical_vrbo, ttlock_account_id, ttlock_lock_id")
    .eq("tenant_id", tenantId);

  if (!props?.length) return NextResponse.json({ properties: [] });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, property_id, guest_name, guest_phone, guest_doc, guest_nationality, check_in, check_out, status, source, booking_url, source_uid, total_price, num_guests, note, channel_code, phone_last4, block_type, requires_cleaning")
    .in("property_id", (props as { id: string }[]).map((p) => p.id))
    .neq("status", "cancelled");

  const result = (props as {
    id: string;
    name: string;
    address: string | null;
    price: number | null;
    ical_airbnb: string | null;
    ical_vrbo: string | null;
    ttlock_account_id: string | null;
    ttlock_lock_id: string | number | null;
  }[]).map((prop) => {
    const channel = prop.ical_airbnb ? "airbnb" : prop.ical_vrbo ? "vrbo" : "direct";
    return {
      id: prop.id,
      name: prop.name,
      address: prop.address ?? "",
      price: prop.price ?? 0,
      channel,
      // TTLock info para que KeysPanel sepa si puede programar el PIN en la
      // cerradura directamente al mandar el código al huésped.
      ttlockAccountId: prop.ttlock_account_id ?? null,
      ttlockLockId: prop.ttlock_lock_id != null ? String(prop.ttlock_lock_id) : null,
      bookings: ((bookings ?? []) as Array<Record<string, unknown>>)
        .filter((b) => b.property_id === prop.id)
        .map((b) => ({
          id: b.id,
          guest: b.guest_name,
          phone: b.guest_phone ?? null,
          phone4: b.guest_phone
            ? String(b.guest_phone).replace(/\D/g, "").slice(-4)
            : null,
          guestDoc: b.guest_doc ?? null,
          guestNationality: b.guest_nationality ?? null,
          start: b.check_in,
          end: b.check_out,
          status: b.status,
          channel: b.source,
          bookingUrl: b.booking_url ?? null,
          sourceUid: b.source_uid ?? null,
          totalPrice: b.total_price ?? 0,
          numGuests: b.num_guests ?? 1,
          note: b.note ?? null,
          channelCode: b.channel_code ?? null,
          phoneLast4: b.phone_last4 ?? null,
          // Bloqueos: tipo + flag de limpieza. null para reservas reales.
          blockType: b.block_type ?? null,
          requiresCleaning: b.requires_cleaning ?? false,
        })),
    };
  });

  return NextResponse.json({ properties: result });
}
