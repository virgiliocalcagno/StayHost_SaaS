import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

/**
 * /api/staff-access — asignaciones staff↔propiedad con PIN fijo.
 *
 * El PIN se guarda acá pero NO se sube a la cerradura inmediatamente.
 * Solo se activa cuando se asigna una tarea de limpieza a esa persona
 * en esa propiedad — ahí se genera un access_pin period del día.
 *
 * Ventana horaria: global hardcoded a 8am-6pm del día de la tarea.
 */

const STAFF_DEFAULT_WINDOW_START = "08:00";
const STAFF_DEFAULT_WINDOW_END = "18:00";

// GET /api/staff-access?team_member_id=X | ?property_id=Y
export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const url = new URL(req.url);
  const teamMemberId = url.searchParams.get("team_member_id");
  const propertyId = url.searchParams.get("property_id");

  let query = supabase
    .from("staff_property_access")
    .select(`
      id, team_member_id, property_id, pin_code,
      is_active, notes,
      created_at, updated_at,
      properties:property_id ( name, address )
    `)
    .order("created_at", { ascending: false });

  if (teamMemberId) query = query.eq("team_member_id", teamMemberId);
  if (propertyId) query = query.eq("property_id", propertyId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    assignments: data ?? [],
    defaultWindow: {
      start: STAFF_DEFAULT_WINDOW_START,
      end: STAFF_DEFAULT_WINDOW_END,
    },
  });
}

// POST /api/staff-access
// Body: { teamMemberId, propertyId, pinCode?, notes? }
//
// pinCode: opcional. Si no viene, generamos uno aleatorio de 6 dígitos.
// El PIN no se sube a la cerradura todavía — eso pasa cuando se asigna
// una tarea de limpieza al staff en esa propiedad.
export async function POST(req: NextRequest) {
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

  const teamMemberId = String(body.teamMemberId ?? "");
  const propertyId = String(body.propertyId ?? "");
  if (!teamMemberId || !propertyId) {
    return NextResponse.json({ error: "teamMemberId y propertyId son obligatorios" }, { status: 400 });
  }

  let pinCode = String(body.pinCode ?? "").trim();
  if (pinCode && !/^\d{4,8}$/.test(pinCode)) {
    return NextResponse.json({ error: "PIN debe tener 4-8 dígitos" }, { status: 400 });
  }
  if (!pinCode) {
    // Generar 6 dígitos sin 0 inicial.
    const first = 1 + Math.floor(Math.random() * 9);
    const rest = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    pinCode = `${first}${rest}`;
  }

  // Validar que la propiedad y el miembro existen y son del tenant.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", propertyId)
    .maybeSingle<{ id: string; name: string }>();
  if (!prop) return NextResponse.json({ error: "Propiedad no encontrada" }, { status: 404 });

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("id", teamMemberId)
    .maybeSingle<{ id: string; name: string }>();
  if (!member) return NextResponse.json({ error: "Miembro del equipo no encontrado" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: insErr } = await (supabase.from("staff_property_access") as any)
    .insert({
      tenant_id: tenantId,
      team_member_id: teamMemberId,
      property_id: propertyId,
      pin_code: pinCode,
      is_active: true,
      notes: body.notes ? String(body.notes) : null,
    })
    .select("id, pin_code")
    .single();
  if (insErr || !row) {
    return NextResponse.json({ error: insErr?.message ?? "No se pudo crear la asignación" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: (row as { id: string }).id,
    pinCode: (row as { pin_code: string }).pin_code,
  });
}
