import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { ServiceVendor } from "@/types/vendor";

type VendorRow = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: string;
  subcategories: unknown;
  properties_scope: unknown;
  notes: string | null;
  rating: number | null;
  active: boolean;
  is_preferred: boolean;
  created_at: string;
  updated_at: string;
};

function rowToVendor(row: VendorRow): ServiceVendor {
  const scope = row.properties_scope;
  let propertiesScope: ServiceVendor["propertiesScope"] = "all";
  if (Array.isArray(scope)) propertiesScope = scope as string[];
  else if (scope !== "all" && typeof scope === "string") propertiesScope = "all";
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    type: row.type as ServiceVendor["type"],
    subcategories: Array.isArray(row.subcategories) ? (row.subcategories as string[]) : [],
    propertiesScope,
    notes: row.notes,
    rating: row.rating,
    active: row.active,
    isPreferred: row.is_preferred,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/vendors  — optional ?type=maintenance&active=true
export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let query = supabase
    .from("service_vendors")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("is_preferred", { ascending: false })
    .order("name", { ascending: true });

  const type = req.nextUrl.searchParams.get("type");
  if (type) query = query.eq("type", type);

  const activeOnly = req.nextUrl.searchParams.get("active");
  if (activeOnly === "true") query = query.eq("active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    vendors: (data ?? []).map((r) => rowToVendor(r as VendorRow)),
  });
}

export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      name,
      phone,
      email,
      type,
      subcategories,
      propertiesScope,
      notes,
      rating,
      active,
      isPreferred,
    } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("service_vendors")
      .insert({
        tenant_id: tenantId,
        name,
        phone: phone ?? null,
        email: email ?? null,
        type,
        subcategories: Array.isArray(subcategories) ? subcategories : [],
        properties_scope: propertiesScope ?? "all",
        notes: notes ?? null,
        rating: typeof rating === "number" ? rating : null,
        active: active !== false,
        is_preferred: !!isPreferred,
      } as never)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, vendor: rowToVendor(data as VendorRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const body = await req.json();
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.email !== undefined) update.email = body.email;
    if (body.type !== undefined) update.type = body.type;
    if (body.subcategories !== undefined) update.subcategories = body.subcategories;
    if (body.propertiesScope !== undefined) update.properties_scope = body.propertiesScope;
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.rating !== undefined) update.rating = body.rating;
    if (body.active !== undefined) update.active = body.active;
    if (body.isPreferred !== undefined) update.is_preferred = body.isPreferred;

    const { error, count } = await supabase
      .from("service_vendors")
      .update(update as never, { count: "exact" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("service_vendors")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
