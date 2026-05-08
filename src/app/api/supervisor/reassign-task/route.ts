import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/supervisor/reassign-task
// Body: { taskId: string, newAssigneeId: string | null, reason?: string }
//
// Reasigna una cleaning_task a otro miembro. Cubre el caso clásico:
// "Sofia se enfermó, Helen pasa la limpieza a María".
//
// Reglas:
//   - Solo admin o supervisor pueden reasignar.
//   - Supervisor puede reasignar SI:
//       (a) la propiedad está bajo su coordinación, O
//       (b) el assignee actual pertenece a su equipo.
//   - El nuevo assignee debe estar en el tenant. Si el caller es supervisor,
//     además el nuevo assignee debe estar en su equipo (newAssignee.supervisor_id = viewer.id)
//     o ser él mismo (Helen se asigna la tarea de Sofia).
//   - newAssigneeId == null desasigna (status pasa a "unassigned").
//   - Resetea closure_photos, is_waiting_validation, rejection_note. Si la
//     tarea ya estaba validada, NO se permite reasignar (bloqueo duro).

interface Body {
  taskId?: string;
  newAssigneeId?: string | null;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, newAssigneeId } = body;
  if (!taskId) {
    return NextResponse.json({ error: "taskId requerido" }, { status: 400 });
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
    return NextResponse.json(
      { error: "Solo admin o supervisor pueden reasignar." },
      { status: 403 },
    );
  }

  // 1. Cargar la tarea + supervisor de la propiedad + supervisor del assignee.
  const { data: taskRow, error: taskErr } = await supabase
    .from("cleaning_tasks")
    .select(
      "id, status, assignee_id, validated_at, property_id, properties:property_id(supervisor_id)",
    )
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });
  const task = taskRow as
    | {
        id: string;
        status: string;
        assignee_id: string | null;
        validated_at: string | null;
        property_id: string | null;
        properties: { supervisor_id: string | null } | null;
      }
    | null;
  if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  if (task.validated_at) {
    return NextResponse.json(
      { error: "Esta tarea ya está aprobada — no se puede reasignar." },
      { status: 409 },
    );
  }

  // 2. ¿Puede el viewer reasignar esta tarea?
  if (viewer && viewer.role === "supervisor") {
    const propertyMatches = task.properties?.supervisor_id === viewer.id;

    let assigneeOnHisTeam = false;
    if (task.assignee_id) {
      const { data: a } = await supabase
        .from("team_members")
        .select("supervisor_id")
        .eq("id", task.assignee_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      assigneeOnHisTeam =
        (a as { supervisor_id: string | null } | null)?.supervisor_id === viewer.id;
    }

    if (!propertyMatches && !assigneeOnHisTeam) {
      return NextResponse.json(
        {
          error:
            "No podés reasignar esta tarea: ni la propiedad está bajo tu coordinación ni el asignado actual es de tu equipo.",
        },
        { status: 403 },
      );
    }
  }

  // 3. Validar el nuevo assignee si vino.
  let newAssigneeName: string | null = null;
  let newAssigneeAvatar: string | null = null;
  if (newAssigneeId) {
    const { data: newRow } = await supabase
      .from("team_members")
      .select("id, name, avatar_url, role, supervisor_id")
      .eq("id", newAssigneeId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const target = newRow as
      | {
          id: string;
          name: string;
          avatar_url: string | null;
          role: string;
          supervisor_id: string | null;
        }
      | null;
    if (!target) {
      return NextResponse.json(
        { error: "El miembro destino no existe en este tenant." },
        { status: 404 },
      );
    }
    if (target.role !== "cleaner" && target.role !== "maintenance" && target.role !== "supervisor") {
      return NextResponse.json(
        { error: "Solo se reasigna a cleaner, mantenimiento o supervisor." },
        { status: 400 },
      );
    }
    if (!isAdmin) {
      const isSelf = target.id === viewer!.id;
      const isOnHisTeam = target.supervisor_id === viewer!.id;
      if (!isSelf && !isOnHisTeam) {
        return NextResponse.json(
          { error: "Solo podés reasignar a tu equipo o a vos misma." },
          { status: 403 },
        );
      }
    }
    newAssigneeName = target.name;
    newAssigneeAvatar = target.avatar_url;
  }

  // 4. Update — limpia estado de la ejecución previa para que el nuevo
  // assignee arranque de cero. Status: assigned si hay nuevo, unassigned si no.
  const update: Record<string, unknown> = {
    assignee_id: newAssigneeId ?? null,
    assignee_name: newAssigneeName,
    assignee_avatar: newAssigneeAvatar,
    status: newAssigneeId ? "assigned" : "unassigned",
    is_waiting_validation: false,
    closure_photos: [],
    rejection_note: null,
    start_time: null,
    declined_by_ids: [],
  };

  const { error: updErr } = await supabase
    .from("cleaning_tasks")
    .update(update as never)
    .eq("id", taskId)
    .eq("tenant_id", tenantId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Recalcular cleaner_payout/supervisor_payout porque el trigger inherit
  // sólo corre BEFORE INSERT. Sin esto, reasignar de Sofia (override 2500) a
  // Helen (override 3000) deja la fila con 2500 y la wallet de Helen cobra
  // mal. Ver lib/cleaning/recompute-prices.ts.
  const { recomputeTaskPricesForTask } = await import(
    "@/lib/cleaning/recompute-prices"
  );
  const { updated: priceRecomputed } = await recomputeTaskPricesForTask(
    supabase,
    taskId,
  );

  return NextResponse.json({
    ok: true,
    taskId,
    newAssigneeId: newAssigneeId ?? null,
    newAssigneeName,
    priceRecomputed,
  });
}
