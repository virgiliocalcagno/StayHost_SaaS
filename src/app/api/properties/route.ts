import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/properties
// Returns the properties owned by the authenticated user's tenant.
// Tenant is resolved from the session cookie — the `email` query param is
// no longer accepted.
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const { data: props, error } = await supabase
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
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ properties: props ?? [] });
}
