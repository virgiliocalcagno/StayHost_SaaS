import { NextRequest, NextResponse } from "next/server";
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
      ttlock_lock_id, ttlock_account_id,
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

// PATCH /api/properties
// Body: { propertyId, ...patch }
//
// Allow-list approach: we only let the client update a small set of fields.
// Currently used by the TTLock multi-account UI to link a lock to a
// property. Other bulk edits go through /api/properties/sync.
//
// RLS on `properties` already prevents cross-tenant writes, but we still
// require propertyId + look it up under the session tenant for a clear 404.
const ALLOWED_FIELDS = new Set([
  "ttlock_lock_id",
  "ttlock_account_id",
  // Add more as the UI grows; don't forget to keep migrations in sync.
]);

export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = String(body.propertyId ?? "");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "propertyId") continue;
    if (!ALLOWED_FIELDS.has(k)) continue;
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("properties")
    .update(patch as never, { count: "exact" })
    .eq("id", propertyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
