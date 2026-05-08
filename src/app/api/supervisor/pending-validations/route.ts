import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/supervisor/pending-validations
//
// Cola de tareas esperando aprobación del supervisor que llama. Para admin
// devuelve todas las del tenant; para supervisor solo las de propiedades
// bajo su supervisión (properties.supervisor_id === viewer.id).
//
// Cada fila trae lo mínimo para renderizar la card y el detalle de
// revisión: nombre del cleaner, propiedad, fotos de cierre, criterios de
// evidencia esperados de la propiedad. NO devuelve datos PII del huésped.

const MAX_ROWS = 100;

interface RawTask {
  id: string;
  property_id: string | null;
  due_date: string;
  due_time: string | null;
  start_time: string | null;
  assignee_id: string | null;
  closure_photos: { category: string; url: string }[] | null;
  reported_issues: string[] | null;
  rejection_note: string | null;
  status: string;
  is_waiting_validation: boolean;
  properties: {
    name: string | null;
    cover_image: string | null;
    evidence_criteria: string[] | null;
    supervisor_id: string | null;
  } | null;
}

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data: memberRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = memberRow as { id: string; role: string } | null;

  // Owner sin team_member es admin de hecho. Supervisor y admin pueden ver
  // pendientes; cleaner no.
  const isAdmin = !viewer || viewer.role === "admin";
  if (viewer && viewer.role !== "admin" && viewer.role !== "supervisor") {
    return NextResponse.json(
      { error: "Solo admin o supervisor ven la cola de aprobación." },
      { status: 403 },
    );
  }

  const { data: tasksData, error } = await supabase
    .from("cleaning_tasks")
    .select(
      "id, property_id, due_date, due_time, start_time, assignee_id, closure_photos, reported_issues, rejection_note, status, is_waiting_validation, properties:property_id(name, cover_image, evidence_criteria, supervisor_id)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_waiting_validation", true)
    .is("validated_at", null)
    .order("due_date", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (tasksData ?? []) as unknown as RawTask[];

  // Filtro por supervisor (regla canónica de cadena de aprobación):
  //   - tareas de propiedades que coordina (property.supervisor_id == me), O
  //   - tareas asignadas a un cleaner de su equipo (assignee.supervisor_id == me), O
  //   - tareas asignadas a sí mismo (las ve para escalar al admin, no se las puede aprobar)
  // Admin ve todo.
  let filtered = rows;
  if (!isAdmin) {
    // Resolvemos en una query qué cleaners pertenecen al equipo del supervisor.
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

  // Resolver nombres de cleaners en una sola query.
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

  const validations = filtered.map(r => ({
    taskId: r.id,
    propertyId: r.property_id,
    propertyName: r.properties?.name ?? "Propiedad",
    propertyImage: r.properties?.cover_image ?? null,
    evidenceCriteria: r.properties?.evidence_criteria ?? [],
    dueDate: r.due_date,
    dueTime: r.due_time,
    startTime: r.start_time,
    assigneeName: r.assignee_id ? assigneeMap.get(r.assignee_id) ?? "Cleaner" : "Sin asignar",
    closurePhotos: r.closure_photos ?? [],
    reportedIssues: r.reported_issues ?? [],
    previousRejection: r.rejection_note,
  }));

  return NextResponse.json({
    validations,
    viewerRole: viewer?.role ?? "admin",
  });
}
