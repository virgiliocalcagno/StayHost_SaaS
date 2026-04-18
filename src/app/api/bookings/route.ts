import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// POST /api/bookings — create a manual booking or block
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      propertyId, tenantEmail, checkIn, checkOut,
      guestName, guestPhone, guestDoc, guestNationality,
      source, note, numGuests, totalPrice,
    } = body;

    if (!propertyId || !tenantEmail || !checkIn || !checkOut) {
      return NextResponse.json({ error: "propertyId, tenantEmail, checkIn, checkOut required" }, { status: 400 });
    }

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("email", tenantEmail)
      .single();

    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const isBlock = source === "block";

    const { data, error } = await supabaseAdmin.from("bookings").insert({
      property_id: propertyId,
      tenant_id: (tenant as any).id,
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
    } as any).select("id").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: (data as any).id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// DELETE /api/bookings?bookingId=xxx — delete a booking or block
export async function DELETE(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get("bookingId");
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("bookings").delete().eq("id", bookingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// GET /api/bookings?email=tenant@example.com
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("email", email)
    .single();

  if (!tenant) return NextResponse.json({ properties: [] });

  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("id, name, address, price, ical_airbnb, ical_vrbo")
    .eq("tenant_id", (tenant as any).id);

  if (!props?.length) return NextResponse.json({ properties: [] });

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, property_id, guest_name, guest_phone, guest_doc, guest_nationality, check_in, check_out, status, source, booking_url, source_uid, total_price, num_guests, note")
    .in("property_id", (props as any[]).map((p) => p.id))
    .neq("status", "cancelled");

  const result = (props as any[]).map((prop) => {
    const channel = prop.ical_airbnb ? "airbnb" : prop.ical_vrbo ? "vrbo" : "direct";
    return {
      id: prop.id,
      name: prop.name,
      address: prop.address ?? "",
      price: prop.price ?? 0,
      channel,
      bookings: ((bookings ?? []) as any[])
        .filter((b) => b.property_id === prop.id)
        .map((b) => ({
          id: b.id,
          guest: b.guest_name,
          phone: b.guest_phone ?? null,
          phone4: b.guest_phone ? b.guest_phone.replace(/\D/g, "").slice(-4) : null,
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
