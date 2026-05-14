import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/cleaning-tasks/:id/validate
// Body opcional: { rejectionNote?: string }
//
// - Sin body o { approved: true } (default) → aprueba: setea validated_at,
//   validated_by, rejection_note=null, append "approved" al approval_log.
// - Con { approved: false, rejectionNote } → pide re-foto: deja
//   validated_at en null, status pasa a "in_progress" para que el cleaner
//   re-haga, set rejection_note y append "rejected" al log.
//
// Reglas duras (docs/modulo-limpieza-modelo-canonico.md §8):
//   * Solo admin o supervisor pueden validar.
//   * Nadie aprueba su propia tarea (assignee_id === viewer.id).
//   * Si el viewer es supervisor, debe ser el supervisor de la propiedad
//     (properties.supervisor_id === viewer.id) o admin override.

interface ValidateBody {
  approved?: boolean;
  rejectionNote?: string;
}

interface ApprovalLogEntry {
  // by = team_members.id cuando admin/supervisor del equipo aprueba.
  // by = null cuando aprueba el dueño del tenant — guardar su auth user_id
  // acá lo expondría al staff vía GET /cleaning-tasks. role: "owner" basta
  // para auditar quién aprobó sin filtrar PII.
  by: string | null;
  role: string;
  action: "approved" | "rejected";
  at: string;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await ctx.params;
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ValidateBody;
  const approved = body.approved !== false;
  const rejectionNote = body.rejectionNote?.trim();

  if (!approved && !rejectionNote) {
    return NextResponse.json(
      { error: "Para pedir re-foto, dejá una nota explicando qué falta." },
      { status: 400 },
    );
  }

  // El viewer puede ser:
  //   1. Un team_member con role admin/supervisor.
  //   2. El dueño del tenant (tenants.user_id = auth.uid()) — en este caso lo
  //      tratamos como admin aunque no figure en team_members. La regla
  //      anti-fraude (assignee !== viewer) sigue aplicando porque el dueño
  //      no debería estar limpiando tareas (no tiene team_members.id).
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  let viewer = memberRow as { id: string; role: string } | null;

  let viewerIsOwner = false;
  if (!viewer) {
    const { data: ownerRow } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownerRow) {
      // El dueño no tiene team_members row → guardamos su auth user_id en
      // el approval_log y validated_by queda NULL (la columna es FK a
      // team_members.id, no podemos meter un auth.uid() ahí). El registro
      // canónico de quién aprobó queda en approval_log.
      viewer = { id: user.id, role: "admin" };
      viewerIsOwner = true;
    }
  }

  if (!viewer) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (viewer.role !== "admin" && viewer.role !== "supervisor") {
    return NextResponse.json(
      { error: "Solo admin o supervisor pueden validar evidencia." },
      { status: 403 },
    );
  }

  // Traemos también el supervisor_id del cleaner asignado para aplicar la
  // regla de cadena de aprobación: el supervisor aprueba al cleaner solo
  // si el cleaner pertenece a su equipo (assignee.supervisor_id === me) o
  // si la propiedad está bajo su coordinación (property.supervisor_id === me).
  const { data: taskRow, error: taskErr } = await supabase
    .from("cleaning_tasks")
    .select(
      "id, assignee_id, property_id, approval_log, properties:property_id(supervisor_id)",
    )
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (taskErr) {
    return NextResponse.json({ error: taskErr.message }, { status: 500 });
  }
  const task = taskRow as
    | {
        id: string;
        assignee_id: string | null;
        property_id: string | null;
        approval_log: ApprovalLogEntry[] | null;
        properties: { supervisor_id: string | null } | null;
      }
    | null;
  if (!task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  // Anti-fraude: nadie aprueba la propia. Si la limpió el supervisor, la
  // tiene que aprobar el admin (regla canónica).
  if (task.assignee_id === viewer.id) {
    return NextResponse.json(
      {
        error:
          "No podés aprobar tu propia tarea. Como la limpiaste vos, debe aprobarla el admin.",
      },
      { status: 403 },
    );
  }

  // Cadena de aprobación para supervisor:
  //   admin → puede aprobar cualquier tarea.
  //   supervisor → puede aprobar si:
  //     (a) la propiedad está bajo su coordinación, O
  //     (b) el cleaner asignado pertenece a su equipo (supervisor_id = él).
  if (viewer.role === "supervisor") {
    const propertyMatches = task.properties?.supervisor_id === viewer.id;

    let cleanerOnHisTeam = false;
    if (task.assignee_id) {
      const { data: assigneeRow } = await supabase
        .from("team_members")
        .select("supervisor_id")
        .eq("id", task.assignee_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const assignee = assigneeRow as { supervisor_id: string | null } | null;
      cleanerOnHisTeam = assignee?.supervisor_id === viewer.id;
    }

    if (!propertyMatches && !cleanerOnHisTeam) {
      return NextResponse.json(
        {
          error:
            "No podés aprobar esta tarea: ni la propiedad está bajo tu coordinación ni el ejecutor está en tu equipo. Pedile al admin.",
        },
        { status: 403 },
      );
    }
  }

  const nowIso = new Date().toISOString();
  const logEntry: ApprovalLogEntry = {
    by: viewerIsOwner ? null : viewer.id,
    role: viewerIsOwner ? "owner" : viewer.role,
    action: approved ? "approved" : "rejected",
    at: nowIso,
    ...(rejectionNote ? { note: rejectionNote } : {}),
  };
  const newLog = [...(task.approval_log ?? []), logEntry];

  // validated_by es FK a team_members(id). Si el aprobador es el dueño del
  // tenant (sin row en team_members), dejamos validated_by en null pero el
  // approval_log conserva quién aprobó (con role=owner y by=auth user_id).
  const validatedByForRow = viewerIsOwner ? null : viewer.id;

  const patch = approved
    ? {
        validated_at: nowIso,
        validated_by: validatedByForRow,
        rejection_note: null,
        is_waiting_validation: false,
        approval_log: newLog,
      }
    : {
        validated_at: null,
        rejection_note: rejectionNote,
        // Vuelve a in_progress para que el cleaner re-haga la evidencia.
        status: "in_progress",
        is_waiting_validation: false,
        approval_log: newLog,
      };

  const { error: updateErr } = await supabase
    .from("cleaning_tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("tenant_id", tenantId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action: approved ? "approved" : "rejected",
    at: nowIso,
  });
}
