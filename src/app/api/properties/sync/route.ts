import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { property, tenantEmail } = body;

    if (!property?.id || !tenantEmail) {
      return NextResponse.json({ error: "property.id and tenantEmail required", got: { id: property?.id, tenantEmail } }, { status: 400 });
    }

    // Step 1: upsert tenant
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .upsert({ email: tenantEmail } as any, { onConflict: "email" })
      .select("id")
      .single();

    if (tenantErr || !tenant) {
      return NextResponse.json({ step: "tenant_upsert", error: tenantErr?.message ?? "no tenant", details: tenantErr }, { status: 500 });
    }

    // Step 2: extract iCal URLs from channels
    const channels: { name: string; icalUrl?: string }[] = property.channels ?? [];
    const ical_airbnb = channels.find(c => c.name?.toLowerCase() === "airbnb")?.icalUrl ?? null;
    const ical_vrbo = channels.find(c => ["vrbo", "homeaway"].includes(c.name?.toLowerCase()))?.icalUrl ?? null;

    // Step 3: upsert property with all fields
    const { data, error: propErr } = await supabaseAdmin
      .from("properties")
      .upsert(
        {
          id: property.id,
          tenant_id: (tenant as any).id,
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
        } as any,
        { onConflict: "id" }
      )
      .select("id, ical_token")
      .single();

    if (propErr) {
      return NextResponse.json({ step: "property_upsert", error: propErr.message, details: propErr }, { status: 500 });
    }

    const d = data as any;
    return NextResponse.json({ ok: true, id: d.id, tenant_id: (tenant as any).id, ical_token: d.ical_token });
  } catch (err: any) {
    return NextResponse.json({ step: "exception", error: err?.message ?? String(err) }, { status: 500 });
  }
}

// GET for quick connectivity test
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing env vars", NEXT_PUBLIC_SUPABASE_URL: !!url, SUPABASE_SERVICE_ROLE_KEY: !!key });
  }
  const { data, error } = await supabaseAdmin.from("tenants").select("id").limit(1);
  return NextResponse.json({ ok: !error, error: error?.message, data });
}
