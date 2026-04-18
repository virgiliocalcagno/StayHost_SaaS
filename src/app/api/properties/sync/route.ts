import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// POST /api/properties/sync
// Called by the frontend when a property is created or updated.
// Upserts the property to Supabase alongside the existing localStorage save.
export async function POST(req: NextRequest) {
  try {
    const { property, tenantEmail } = await req.json();

    if (!property?.id || !tenantEmail) {
      return NextResponse.json({ error: "property.id and tenantEmail required" }, { status: 400 });
    }

    // Upsert tenant by email (creates if not exists)
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .upsert({ email: tenantEmail }, { onConflict: "email" })
      .select("id")
      .single();

    if (tenantErr || !tenant) {
      console.error("[properties/sync] tenant upsert failed", tenantErr);
      return NextResponse.json({ error: "Could not resolve tenant" }, { status: 500 });
    }

    // Extract iCal URLs from channels array
    const channels: { name: string; icalUrl?: string }[] = property.channels ?? [];
    const ical_airbnb = channels.find(c => c.name?.toLowerCase() === "airbnb")?.icalUrl || null;
    const ical_vrbo = channels.find(c => ["vrbo", "homeaway"].includes(c.name?.toLowerCase()))?.icalUrl || null;

    const { data, error } = await supabaseAdmin.from("properties").upsert(
      {
        id: property.id,
        tenant_id: tenant.id,
        name: property.name,
        address: property.address ?? null,
        cover_image: property.image ?? null,
        ical_airbnb,
        ical_vrbo,
        wifi_name: property.wifiSsid ?? null,
        wifi_password: property.wifiPassword ?? null,
        electricity_enabled: property.electricityEnabled ?? false,
        electricity_rate: property.electricityRate ?? 0,
        ttlock_lock_id: property.ttlockLockId ?? null,
      },
      { onConflict: "id" }
    ).select("id, ical_token").single();

    if (error) {
      console.error("[properties/sync]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return the ical_token so the frontend can show the blocking URL
    return NextResponse.json({ ok: true, id: data.id, tenant_id: tenant.id, ical_token: data.ical_token });
  } catch (err) {
    console.error("[properties/sync]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
