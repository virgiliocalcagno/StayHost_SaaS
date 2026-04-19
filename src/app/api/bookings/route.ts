import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// All three handlers read the tenant_id from the authenticated session
// cookie. They no longer accept `tenantEmail` in the body or `?email=` in
// the query — those were the backdoor that let anyone with the right email
// read or delete someone else's data.

// POST /api/bookings — create a manual booking or block
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      propertyId, checkIn, checkOut,
      guestName, guestPhone, guestDoc, guestNationality,
      source, note, numGuests, totalPrice,
    } = body;

    if (!propertyId || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "propertyId, checkIn, checkOut required" },
        { status: 400 }
      );
    }

    const isBlock = source === "block";

    const { data, error } = await supabase.from("bookings").insert({
      property_id: propertyId,
      tenant_id: tenantId,
      source_uid: `manual-${Date.now()}`,
      source: source ?? "manual",
      guest_name: guestName ?? (isBlock ? "Bloqueado" : "Huésped"),
      guest_phone: guestPhone ?? null,
      guest_doc: guestDoc ?? null,
      guest_nationality: guestNationality ?? null,
      check_in: checkIn,
      check_out: checkOut,
      status: isBlock ? "blocked" : "confirmed",
      total_price: totalPrice ?? 0,
      num_guests: numGuests ?? 1,
      note: note ?? null,
    } as never).select("id").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: (data as { id: string }).id });
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
    .select("id, name, address, price, ical_airbnb, ical_vrbo")
    .eq("tenant_id", tenantId);

  if (!props?.length) return NextResponse.json({ properties: [] });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, property_id, guest_name, guest_phone, guest_doc, guest_nationality, check_in, check_out, status, source, booking_url, source_uid, total_price, num_guests, note")
    .in("property_id", (props as { id: string }[]).map((p) => p.id))
    .neq("status", "cancelled");

  const result = (props as {
    id: string;
    name: string;
    address: string | null;
    price: number | null;
    ical_airbnb: string | null;
    ical_vrbo: string | null;
  }[]).map((prop) => {
    const channel = prop.ical_airbnb ? "airbnb" : prop.ical_vrbo ? "vrbo" : "direct";
    return {
      id: prop.id,
      name: prop.name,
      address: prop.address ?? "",
      price: prop.price ?? 0,
      channel,
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
        })),
    };
  });

  return NextResponse.json({ properties: result });
}
