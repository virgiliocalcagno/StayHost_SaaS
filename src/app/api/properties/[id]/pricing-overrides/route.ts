import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { recomputeTaskPricesForProperty } from "@/lib/cleaning/recompute-prices";

// GET /api/properties/[id]/pricing-overrides
// Devuelve los overrides de pago por miembro para esta propiedad.
// PUT  /api/properties/[id]/pricing-overrides
// Body: { overrides: [{ memberId, role, amount }] }
//   - amount === null borra el override.
//   - reemplaza el set completo de overrides para la propiedad (idempotente).
//
// AUTH: PUT solo permite al dueño del tenant (tenants.user_id = auth.uid()).
// RLS también lo bloquea pero el chequeo en el handler da un 403 con mensaje
// claro en vez de un fallo silencioso de policy.

type Role = "cleaner" | "supervisor";

interface OverridePatch {
  memberId: string;
  role: Role;
  amount: number | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }
  const { id: propertyId } = await ctx.params;

  const { data, error } = await supabase
    .from("cleaning_pricing_overrides")
    .select("id, member_id, role, amount, currency, updated_at")
    .eq("property_id", propertyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    overrides: (data ?? []).map(o => ({
      id: o.id,
      memberId: o.member_id,
      role: o.role,
      amount: Number(o.amount),
      currency: o.currency,
      updatedAt: o.updated_at,
    })),
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }
  const { id: propertyId } = await ctx.params;

  // Sólo el dueño del tenant puede mutar tarifas. Un cleaner/supervisor del
  // mismo tenant pasaría el filtro de tenantId pero no este chequeo.
  const { data: ownerRow } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerRow) {
    return NextResponse.json(
      { error: "Solo el dueño del tenant puede modificar tarifas." },
      { status: 403 },
    );
  }

  let body: { overrides?: OverridePatch[] };
  try {
    body = (await req.json()) as { overrides?: OverridePatch[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patches = Array.isArray(body.overrides) ? body.overrides : [];

  // Validación básica + chequeo de que la propiedad pertenece al tenant.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, currency")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; currency: string | null }>();
  if (!prop) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }
  const currency = prop.currency || "DOP";

  const toDelete: { memberId: string; role: Role }[] = [];
  const toUpsert: {
    tenant_id: string;
    property_id: string;
    member_id: string;
    role: Role;
    amount: number;
    currency: string;
  }[] = [];

  for (const p of patches) {
    if (!p.memberId || (p.role !== "cleaner" && p.role !== "supervisor")) {
      return NextResponse.json({ error: "memberId + role válido (cleaner|supervisor) requerido" }, { status: 400 });
    }
    if (p.amount === null) {
      toDelete.push({ memberId: p.memberId, role: p.role });
    } else if (typeof p.amount === "number" && p.amount >= 0) {
      toUpsert.push({
        tenant_id: tenantId,
        property_id: propertyId,
        member_id: p.memberId,
        role: p.role,
        amount: p.amount,
        currency,
      });
    } else {
      return NextResponse.json({ error: "amount debe ser number >= 0 o null para borrar" }, { status: 400 });
    }
  }

  // Validar que todos los miembros pertenecen al tenant para evitar inserts cruzados.
  const memberIds = Array.from(new Set([
    ...toUpsert.map(o => o.member_id),
    ...toDelete.map(d => d.memberId),
  ]));
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", memberIds);
    const validIds = new Set((members ?? []).map(m => m.id));
    const invalid = memberIds.filter(m => !validIds.has(m));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Member fuera del tenant: ${invalid.join(",")}` }, { status: 400 });
    }
  }

  if (toDelete.length > 0) {
    for (const d of toDelete) {
      const { error: delErr } = await supabase
        .from("cleaning_pricing_overrides")
        .delete()
        .eq("property_id", propertyId)
        .eq("member_id", d.memberId)
        .eq("role", d.role);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }
  }

  if (toUpsert.length > 0) {
    const { error: upErr } = await supabase
      .from("cleaning_pricing_overrides")
      .upsert(toUpsert, { onConflict: "property_id,member_id,role" });
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  // Backfill: re-aplicar precios resueltos a tareas no validadas.
  const { updated: recomputedTasks } = await recomputeTaskPricesForProperty(
    supabase,
    propertyId,
  );

  return NextResponse.json({
    ok: true,
    upserted: toUpsert.length,
    deleted: toDelete.length,
    recomputedTasks,
  });
}
