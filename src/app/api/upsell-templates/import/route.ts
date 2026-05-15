/**
 * POST /api/upsell-templates/import
 *
 * Clona un upsell_template como upsell del tenant del caller. Valores
 * del template son starting point; el host edita después si quiere.
 *
 * Auth + role guard (owner/admin/manager/co_host). Idempotente NO — un
 * doble click crea 2 upsells idénticos, el host puede borrar uno.
 *
 * Body: { templateId: string }
 * Response: { ok: true, upsell: {...} }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon_name: string;
  hero_photo: string | null;
  suggested_price: string | number;
  currency: string;
  pricing_model: string;
  min_quantity: number;
  max_quantity: number | null;
  capacity_per_slot: number | null;
  cutoff_hours: number;
  active: boolean;
  // Sprint 5
  time_field: string | null;
  pickup_field: string | null;
  flight_field: string | null;
  notes_placeholder: string | null;
};

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Role guard. null member = owner directo, OK.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null) {
    if (!member.role || !MANAGE_ROLES.has(member.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  let body: { templateId?: string };
  try {
    body = (await req.json()) as { templateId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const templateId = String(body.templateId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) {
    return NextResponse.json({ error: "templateId inválido" }, { status: 400 });
  }

  // Leer template (RLS permite SELECT solo si active=true).
  const { data: tpl } = await supabase
    .from("upsell_templates")
    .select("*")
    .eq("id", templateId)
    .eq("active", true)
    .maybeSingle();
  if (!tpl) {
    return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
  }
  const t = tpl as TemplateRow;

  // INSERT en upsells con tenant del caller + valores del template.
  // RLS de upsells acepta porque tenant_id = current_tenant_id() del caller.
  const { data: created, error: insErr } = await supabase
    .from("upsells")
    .insert({
      tenant_id: tenantId,
      vendor_id: null, // el host lo asigna después si quiere
      name: t.name,
      description: t.description,
      category: t.category,
      icon_name: t.icon_name,
      hero_photo: t.hero_photo,
      gallery_photos: [],
      price: Number(t.suggested_price),
      currency: t.currency,
      pricing_model: t.pricing_model,
      min_quantity: t.min_quantity,
      max_quantity: t.max_quantity,
      capacity_per_slot: t.capacity_per_slot,
      cutoff_hours: t.cutoff_hours,
      // Sprint 5: heredar flags de info del servicio del template.
      time_field: t.time_field ?? "off",
      pickup_field: t.pickup_field ?? "off",
      flight_field: t.flight_field ?? "off",
      notes_placeholder: t.notes_placeholder,
      is_global: true,
      linked_property_ids: [],
      active: true,
    } as never)
    .select("*")
    .single();

  if (insErr || !created) {
    return NextResponse.json(
      { error: insErr?.message || "Error clonando template" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, upsell: created });
}
