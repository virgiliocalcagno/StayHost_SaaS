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
    .select(`
      id, name, address, city, cover_image,
      ical_airbnb, ical_vrbo, ical_token,
      wifi_name, wifi_password,
      electricity_enabled, electricity_rate,
      ttlock_lock_id,
      property_type, price, currency,
      cleaning_fee_one_day, cleaning_fee_more_days,
      weekly_discount_percent, energy_fee_per_day, additional_services_fee,
      beds, baths, max_guests, prop_status,
      amenities, owner_payout, staff_pay,
      recurring_supplies, auto_assign_cleaner, cleaner_priorities,
      bed_configuration, standard_instructions, evidence_criteria,
      description_es, description_en, photo_tour, amenities_config,
      created_at
    `)
    .eq("tenant_id", (tenant as any).id);

  return NextResponse.json({ properties: (props ?? []) as any[] });
}
