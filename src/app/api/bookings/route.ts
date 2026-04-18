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
    .select("id, name")
    .eq("tenant_id", tenant.id);

  if (!props?.length) return NextResponse.json({ properties: [] });

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, property_id, guest_name, check_in, check_out, status, source")
    .in("property_id", props.map((p) => p.id));

  const result = props.map((prop) => ({
    id: prop.id,
    name: prop.name,
    channel: "direct",
    price: 0,
    bookings: (bookings ?? [])
      .filter((b) => b.property_id === prop.id)
      .map((b) => ({
        id: b.id,
        guest: b.guest_name,
        start: b.check_in,
        end: b.check_out,
        status: b.status,
        channel: b.source,
      })),
  }));

  return NextResponse.json({ properties: result });
}
