import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cascadeCancelBooking } from "@/lib/bookings/cleanup";
import {
  ensurePinForBooking,
  ensureCheckinRecordForBooking,
} from "@/lib/bookings/side-effects";
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
      // Bloqueos no tienen precio: NULL en BD ≠ 0. NULL significa "no
      // aplica" (no es ingreso) y el modulo contable los excluye sin
      // tener que filtrar por source. Si se convierte en reserva,
      // /api/bookings/[id]/convert completa el precio real.
      total_price: isBlock ? null : (totalPrice ?? 0),
      num_guests: numGuests ?? 1,
      note: note ?? null,
      channel_code: channelCode,
      phone_last4: phoneLast4,
      block_type: blockTypeValue,
      requires_cleaning: requiresCleaningValue,
    };

    let insertRes = await supabase.from("bookings").insert(insertRow as never).select("id").single();

    // Fallback: si las columnas nuevas no existen todavia en prod, reintentar
    // sin ellas. Matcheamos por error code 42703 (undefined_column) en lugar
    // de string-match en el message — un check-constraint que mencione una
    // de estas columnas ya no dispara el retry por error.
    const errCode = (insertRes.error as { code?: string } | null)?.code;
    if (errCode === "42703") {
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

    // Side effects para reservas reales: PIN + checkin_record.
    if (!isBlock) {
      if (guestPhone) {
        await ensurePinForBooking({
          tenantId,
          propertyId: String(propertyId),
          bookingId,
          guestName: guestName ?? "Huésped",
          guestPhone,
          checkIn,
          checkOut,
          source: source ?? "manual",
        });
      }
      await ensureCheckinRecordForBooking({
        tenantId,
        propertyId: String(propertyId),
        bookingId,
        guestName: guestName ?? "Huésped",
        guestDoc,
        guestNationality,
        guestDocPhotoPath,
        checkIn,
        checkOut,
        source: source ?? "manual",
        channelCode,
        phoneLast4,
      });
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

    // Sincronizar cleaning_task de bloqueos cuando cambian flag, tipo o
    // check_out. ensureCleaningTaskForBlock hace upsert: si la task ya
    // existe (no-completed), updatea label y due_date; si no, la crea.
    // - requires_cleaning true → ensure (insert o update segun caso)
    // - requires_cleaning false → quitar task pendiente
    if ("requires_cleaning" in patch || "block_type" in patch || patch.check_out) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: bk } = await (supabaseAdmin.from("bookings") as any)
          .select("source, property_id, tenant_id, check_out, block_type, requires_cleaning")
          .eq("id", bookingId)
          .single();
        if (bk && bk.source === "block") {
          if (bk.requires_cleaning) {
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
    .select("id, name, address, price, ical_airbnb, ical_vrbo, ttlock_account_id, ttlock_lock_id, check_in_time, check_out_time")
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
    check_in_time: string | null;
    check_out_time: string | null;
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
      // Horarios de la propiedad — el calendario los usa para mostrar
      // "Salida 11:00" y "Entrada 14:00" en las celdas back-to-back.
      checkInTime: prop.check_in_time ?? "14:00",
      checkOutTime: prop.check_out_time ?? "12:00",
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
