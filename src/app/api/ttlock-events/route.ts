import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

/**
 * GET /api/ttlock-events?property_id=X&date=YYYY-MM-DD
 *
 * Devuelve los eventos de la cerradura para una propiedad en un día,
 * resolviendo *quién* abrió cuando es posible:
 *   - Si el `keyboard_pwd` matchea un access_pin del staff (team_member_id),
 *     se devuelve el nombre del staff.
 *   - Si matchea un access_pin de huésped (guest_name), se devuelve eso.
 *   - Si no matchea, se devuelve "Desconocido".
 *
 * Solo eventos exitosos (success=1) o récord_type que indica apertura.
 */

interface EventRow {
  id: number;
  lock_id: string;
  record_type: number | null;
  success: number | null;
  username: string | null;
  keyboard_pwd: string | null;
  server_date: number | null;
  received_at: string;
}

interface PinRow {
  pin: string | null;
  guest_name: string | null;
  team_member_id: string | null;
  source: string | null;
}

interface MemberRow {
  id: string;
  name: string;
}

export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("property_id");
  const dateStr = url.searchParams.get("date");
  if (!propertyId) {
    return NextResponse.json({ error: "property_id requerido" }, { status: 400 });
  }

  // Ventana del día (00:00 a 23:59:59 local del server). Si no se pasa
  // fecha, usamos hoy.
  const baseDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return NextResponse.json({ error: "date inválida" }, { status: 400 });
  }
  const dayStart = new Date(baseDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(baseDate);
  dayEnd.setHours(23, 59, 59, 999);

  const { data: events, error } = await supabase
    .from("ttlock_events")
    .select("id, lock_id, record_type, success, username, keyboard_pwd, server_date, received_at")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .gte("received_at", dayStart.toISOString())
    .lte("received_at", dayEnd.toISOString())
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (events ?? []) as EventRow[];

  // Cargamos todos los pins activos/históricos de esta propiedad para
  // hacer matching por pin → quién es.
  const { data: pins } = await supabase
    .from("access_pins")
    .select("pin, guest_name, team_member_id, source")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId);
  const pinList = (pins ?? []) as PinRow[];

  // Resolver nombres de team_members en una sola consulta
  const memberIds = Array.from(
    new Set(pinList.map((p) => p.team_member_id).filter((x): x is string => !!x)),
  );
  const memberById = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name")
      .in("id", memberIds);
    for (const m of ((members ?? []) as MemberRow[])) {
      memberById.set(m.id, m.name);
    }
  }

  // Mapa pin → resolución
  const resolveByPin = new Map<string, { kind: "staff" | "guest" | "owner" | "unknown"; name: string }>();
  for (const p of pinList) {
    if (!p.pin) continue;
    if (p.team_member_id) {
      const name = memberById.get(p.team_member_id) ?? "Staff";
      resolveByPin.set(p.pin, { kind: "staff", name });
    } else if (p.guest_name) {
      resolveByPin.set(p.pin, { kind: "guest", name: p.guest_name });
    } else if (p.source === "owner") {
      resolveByPin.set(p.pin, { kind: "owner", name: "Owner" });
    } else {
      resolveByPin.set(p.pin, { kind: "unknown", name: "Desconocido" });
    }
  }

  const result = rows.map((ev) => {
    const ts = ev.server_date
      ? new Date(ev.server_date).toISOString()
      : ev.received_at;
    const matched = ev.keyboard_pwd ? resolveByPin.get(ev.keyboard_pwd) : undefined;
    return {
      id: ev.id,
      timestamp: ts,
      recordType: ev.record_type,
      success: ev.success,
      keyboardPwd: ev.keyboard_pwd,
      username: ev.username,
      who: matched ?? { kind: "unknown" as const, name: ev.username ?? "Desconocido" },
    };
  });

  return NextResponse.json({ events: result });
}
