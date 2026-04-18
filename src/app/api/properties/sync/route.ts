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

    // Step 2: extract iCal URLs
    const channels: { name: string; icalUrl?: string }[] = property.channels ?? [];
    const ical_airbnb = channels.find(c => c.name?.toLowerCase() === "airbnb")?.icalUrl ?? null;
    const ical_vrbo = channels.find(c => ["vrbo", "homeaway"].includes(c.name?.toLowerCase()))?.icalUrl ?? null;

    // Step 3: upsert property
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
