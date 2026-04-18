import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

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
    .select("id, name, address")
    .eq("tenant_id", (tenant as any).id);

  if (!props?.length) return NextResponse.json({ properties: [] });

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, property_id, guest_name, guest_phone, check_in, check_out, status, source, booking_url, source_uid")
    .in("property_id", (props as any[]).map((p) => p.id));

  const result = (props as any[]).map((prop) => ({
    id: prop.id,
    name: prop.name,
    address: prop.address ?? "",
    bookings: ((bookings ?? []) as any[])
      .filter((b) => b.property_id === prop.id)
      .map((b) => ({
        id: b.id,
        guest: b.guest_name,
        phone: b.guest_phone ?? null,
        phone4: b.guest_phone ? b.guest_phone.replace(/\D/g, "").slice(-4) : null,
        start: b.check_in,
        end: b.check_out,
        status: b.status,
        channel: b.source,
        bookingUrl: b.booking_url ?? null,
        sourceUid: b.source_uid ?? null,
      })),
  }));

  return NextResponse.json({ properties: result });
}
