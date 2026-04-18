import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// GET /api/properties?email=tenant@example.com
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
    .select("id, name, address, cover_image, ical_airbnb, ical_vrbo, wifi_name, wifi_password, electricity_enabled, electricity_rate, ttlock_lock_id, created_at")
    .eq("tenant_id", (tenant as any).id);

  return NextResponse.json({ properties: (props ?? []) as any[] });
}
