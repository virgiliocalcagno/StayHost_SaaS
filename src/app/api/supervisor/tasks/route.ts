import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/supervisor/tasks
// Cronograma de cleaning_tasks de las propiedades que el supervisor coordina.
// Admin ve todas las del tenant. Sin PII de huésped. Default: hoy + 6 días.

interface RawTask {
  id: string;
  property_id: string | null;
  due_date: string;
  due_time: string | null;
  start_time: string | null;
  status: string;
  is_waiting_validation: boolean;
  validated_at: string | null;
  assignee_id: string | null;
  priority: string | null;
  properties: {
    name: string | null;
    cover_image: string | null;
    supervisor_id: string | null;
  } | null;
}

// Ventana de visibilidad: 7 días atrás (para revisar tareas pasadas que
// quedaron sin cerrar) + 60 días adelante (para planificar el mes y pico
// siguiente). Reservas de Airbnb y bloqueos largos pueden caer lejos en
// el calendario; 7 días era miope.
const RANGE_DAYS_BACK = 7;
const RANGE_DAYS_FWD = 60;

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data: viewerRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = viewerRow as { id: string; role: string } | null;

  const isAdmin = !viewer || viewer.role === "admin";
  if (viewer && viewer.role !== "admin" && viewer.role !== "supervisor") {
    return NextResponse.json({ error: "Solo admin o supervisor" }, { status: 403 });
  }

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - RANGE_DAYS_BACK);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + RANGE_DAYS_FWD);
  const toIso = toDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("cleaning_tasks")
    .select(
      "id, property_id, due_date, due_time, start_time, status, is_waiting_validation, validated_at, assignee_id, priority, properties:property_id(name, cover_image, supervisor_id)",
    )
    .eq("tenant_id", tenantId)
    .gte("due_date", fromIso)
    .lte("due_date", toIso)
    .order("due_date", { ascending: true })
    .order("due_time", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as unknown as RawTask[];

  // Supervisor ve (regla canónica de cadena de aprobación):
  //   - tareas de propiedades que coordina (property.supervisor_id == me), O
  //   - tareas asignadas a un cleaner de su equipo (assignee.supervisor_id == me), O
  //   - tareas asignadas a sí mismo (cuando también limpia).
  let filtered = rows;
  if (!isAdmin) {
    const { data: subteam } = await supabase
      .from("team_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("supervisor_id", viewer!.id);
    const teamIds = new Set(((subteam ?? []) as { id: string }[]).map(r => r.id));

    filtered = rows.filter(
      r =>
        r.properties?.supervisor_id === viewer!.id ||
        r.assignee_id === viewer!.id ||
        (r.assignee_id && teamIds.has(r.assignee_id)),
    );
  }

  const assigneeIds = Array.from(
    new Set(filtered.map(r => r.assignee_id).filter((x): x is string => !!x)),
  );
  const assigneeMap = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name")
      .in("id", assigneeIds);
    for (const m of (members ?? []) as { id: string; name: string }[]) {
      assigneeMap.set(m.id, m.name);
    }
  }

  const tasks = filtered.map(r => ({
    taskId: r.id,
    propertyId: r.property_id,
    propertyName: r.properties?.name ?? "Propiedad",
    propertyImage: r.properties?.cover_image ?? null,
    dueDate: r.due_date,
    dueTime: r.due_time,
    startTime: r.start_time,
    status: r.status,
    isWaitingValidation: r.is_waiting_validation,
    validatedAt: r.validated_at,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? assigneeMap.get(r.assignee_id) ?? "Cleaner" : null,
    priority: r.priority,
  }));

  return NextResponse.json({ tasks, viewerRole: viewer?.role ?? "admin" });
}
