import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { generateStaffPin, timeToMinutes, syncCyclicPinToLock } from "@/lib/ttlock/cyclic-pin";

/**
 * /api/staff-access — CRUD de asignaciones staff↔propiedad con PIN cíclico.
 *
 * Scoping: RLS por tenant_id. Cliente nunca envía tenantId.
 *
 * Modelo:
 *   - 1 asignación = 1 fila en staff_property_access + 1 PIN cíclico en
 *     access_pins (is_cyclic=true, team_member_id, cyclic_config).
 *   - Borrar la asignación revoca el PIN en TTLock (best-effort, igual que
 *     access-pins delete).
 */

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
      id, team_member_id, property_id,
      default_window_start, default_window_end, weekdays,
      access_pin_id, is_active, notes,
      created_at, updated_at,
      properties:property_id ( name, address ),
      access_pins:access_pin_id ( pin, sync_status, sync_last_error, ttlock_lock_id, ttlock_pwd_id )
    `)
    .order("created_at", { ascending: false });

  if (teamMemberId) query = query.eq("team_member_id", teamMemberId);
  if (propertyId) query = query.eq("property_id", propertyId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

// POST /api/staff-access
// Body: {
//   teamMemberId, propertyId,
//   defaultWindowStart? "08:00", defaultWindowEnd? "18:00",
//   weekdays?: number[]  // 1=Mon..7=Sun, default [1..7]
//   notes?: string
// }
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

  const defaultWindowStart = String(body.defaultWindowStart ?? "08:00");
  const defaultWindowEnd = String(body.defaultWindowEnd ?? "18:00");
  const weekdaysRaw = Array.isArray(body.weekdays) ? body.weekdays : [1, 2, 3, 4, 5, 6, 7];
  const weekdays = weekdaysRaw
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (weekdays.length === 0) {
    return NextResponse.json({ error: "weekdays debe incluir al menos un día (1-7)" }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(defaultWindowStart) || !/^\d{2}:\d{2}$/.test(defaultWindowEnd)) {
    return NextResponse.json({ error: "Formato HH:MM requerido" }, { status: 400 });
  }
  const startMin = timeToMinutes(defaultWindowStart);
  const endMin = timeToMinutes(defaultWindowEnd);
  if (endMin <= startMin) {
    return NextResponse.json({ error: "Hora de fin debe ser posterior a la de inicio" }, { status: 400 });
  }

  // Validar que la propiedad pertenece al tenant y traer datos para el PIN.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, name, ttlock_lock_id, ttlock_account_id")
    .eq("id", propertyId)
    .maybeSingle<{ id: string; name: string; ttlock_lock_id: string | null; ttlock_account_id: string | null }>();
  if (!prop) return NextResponse.json({ error: "Propiedad no encontrada" }, { status: 404 });

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("id", teamMemberId)
    .maybeSingle<{ id: string; name: string }>();
  if (!member) return NextResponse.json({ error: "Miembro del equipo no encontrado" }, { status: 404 });

  // Generar PIN único — best-effort sin colisión (TTLock manda errcode si
  // ya existe ese passcode en la cerradura, ahí lo regeneramos).
  const pin = generateStaffPin();

  // Crear el access_pin cíclico. Sin cerradura → queda en 'synced'
  // automáticamente (no hay nada que sincronizar). Con cerradura → 'pending'
  // y disparamos el sync fire-and-forget.
  // valid_from/valid_to los usamos como rango global (desde hoy, lejano);
  // la ventana real está en cyclic_config.
  const validFrom = new Date().toISOString();
  const validTo = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString(); // +5 años
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinRow, error: pinErr } = await (supabase.from("access_pins") as any)
    .insert({
      tenant_id: tenantId,
      property_id: propertyId,
      ttlock_lock_id: prop.ttlock_lock_id,
      team_member_id: teamMemberId,
      guest_name: member.name,
      pin,
      source: "manual",
      status: "active",
      is_cyclic: true,
      cyclic_config: { weekDays: weekdays, startMin, endMin },
      valid_from: validFrom,
      valid_to: validTo,
      sync_status: prop.ttlock_lock_id ? "pending" : "synced",
    })
    .select("id")
    .single();
  if (pinErr || !pinRow) {
    return NextResponse.json({ error: pinErr?.message ?? "No se pudo crear el PIN" }, { status: 500 });
  }
  const pinId = (pinRow as { id: string }).id;

  // Crear la asignación
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: assignmentRow, error: assignErr } = await (supabase.from("staff_property_access") as any)
    .insert({
      tenant_id: tenantId,
      team_member_id: teamMemberId,
      property_id: propertyId,
      default_window_start: defaultWindowStart,
      default_window_end: defaultWindowEnd,
      weekdays,
      access_pin_id: pinId,
      is_active: true,
      notes: body.notes ? String(body.notes) : null,
    })
    .select("id")
    .single();
  if (assignErr || !assignmentRow) {
    // Rollback del PIN huérfano
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("access_pins") as any).delete().eq("id", pinId);
    return NextResponse.json({ error: assignErr?.message ?? "No se pudo crear la asignación" }, { status: 500 });
  }

  // Fire-and-forget sync con TTLock (mismo patrón que /api/access-pins POST).
  // En Vercel serverless el sync NO se despacha en background — lo agendamos
  // al cron de sync-pins extendido.
  if (prop.ttlock_lock_id) {
    void syncCyclicPinToLock(pinId).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    id: (assignmentRow as { id: string }).id,
    pinId,
    pin,
  });
}
