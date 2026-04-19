import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/properties/sync
// Upserts a property for the authenticated tenant. The tenant_id is taken
// from the session — callers no longer pass `tenantEmail`. RLS ensures a
// tenant can only upsert rows tagged with their own tenant_id.
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { property } = body;

    if (!property?.id) {
      return NextResponse.json({ error: "property.id required" }, { status: 400 });
    }

    // Extract iCal URLs from the channels array
    const channels: { name?: string; icalUrl?: string }[] = property.channels ?? [];
    const ical_airbnb =
      channels.find((c) => c.name?.toLowerCase() === "airbnb")?.icalUrl ?? null;
    const ical_vrbo =
      channels.find((c) => ["vrbo", "homeaway"].includes(c.name?.toLowerCase() ?? ""))?.icalUrl ?? null;

    const { data, error: propErr } = await supabase
      .from("properties")
      .upsert(
        {
          id: property.id,
          tenant_id: tenantId,
          name: property.name,
          address: property.address ?? null,
          city: property.city ?? null,
          cover_image: property.image ?? null,
          ical_airbnb,
          ical_vrbo,
          wifi_name: property.wifiSsid ?? null,
          wifi_password: property.wifiPassword ?? null,
          electricity_enabled: property.electricityEnabled ?? false,
          electricity_rate: property.electricityRate ?? 0,
          ttlock_lock_id: property.ttlockLockId ?? null,
          property_type: property.type ?? "apartment",
          price: property.price ?? 0,
          cleaning_fee_one_day: property.cleaningFeeOneDay ?? 0,
          cleaning_fee_more_days: property.cleaningFeeMoreDays ?? 0,
          weekly_discount_percent: property.weeklyDiscountPercent ?? 0,
          energy_fee_per_day: property.energyFeePerDay ?? 0,
          additional_services_fee: property.additionalServicesFee ?? 0,
          currency: property.currency ?? "USD",
          beds: property.beds ?? 1,
          baths: property.baths ?? 1,
          max_guests: property.maxGuests ?? 2,
          prop_status: property.status ?? "active",
          amenities: property.amenities ?? [],
          owner_payout: property.ownerPayout ?? 0,
          staff_pay: property.staffPay ?? 0,
          recurring_supplies: property.recurringSupplies ?? [],
          auto_assign_cleaner: property.autoAssignCleaner ?? false,
          cleaner_priorities: property.cleanerPriorities ?? [],
          bed_configuration: property.bedConfiguration ?? null,
          standard_instructions: property.standardInstructions ?? null,
          evidence_criteria: property.evidenceCriteria ?? [],
          description_es: property.descriptionES ?? null,
          description_en: property.descriptionEN ?? null,
          photo_tour: property.photoTour ?? [],
          amenities_config: property.amenitiesConfig ?? {},
        } as never,
        { onConflict: "id" }
      )
      .select("id, ical_token")
      .single();

    if (propErr) {
      return NextResponse.json(
        { step: "property_upsert", error: propErr.message },
        { status: 500 }
      );
    }

    const d = data as { id: string; ical_token: string | null };
    return NextResponse.json({ ok: true, id: d.id, tenant_id: tenantId, ical_token: d.ical_token });
  } catch (err) {
    return NextResponse.json(
      { step: "exception", error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
